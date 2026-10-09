import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import type { LookupFunction } from 'node:net';

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type SafeFetchTarget = {
  hostname: string;
  /** The vetted address the connection must go to: never re-resolved, so DNS cannot change it in between. */
  address: ResolvedAddress;
  path: string;
  timeout_ms: number;
  max_bytes: number;
};

export type SafeFetchResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export type SafeFetcherOptions = {
  timeout_ms?: number;
  max_bytes?: number;
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  send?: (target: SafeFetchTarget) => Promise<SafeFetchResponse>;
};

export class SafeFetchError extends Error {
  constructor(
    readonly reason:
      | 'invalid_url'
      | 'not_https'
      | 'port_not_allowed'
      | 'credentials_in_url'
      | 'unresolvable'
      | 'blocked_address'
      | 'redirect_not_allowed'
      | 'bad_status'
      | 'not_json'
      | 'too_large'
      | 'timeout'
      | 'network',
    message: string
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/**
 * Addresses a server-side fetch must never reach: loopback, private and carrier-grade
 * NAT ranges, link-local (which holds cloud metadata at 169.254.169.254), multicast,
 * reserved and documentation ranges, and their IPv6 counterparts. IPv4-mapped IPv6
 * addresses are matched against the IPv4 rules by BlockList itself.
 */
const BLOCKED_SUBNETS: [string, number, 'ipv4' | 'ipv6'][] = [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6']
];

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const USER_AGENT = 'Cortex-OAuth/1.0 (+https://cortexapp.me)';

/**
 * Fetches a small JSON document from a URL an untrusted party chose - an OAuth client's
 * metadata document - without becoming a way into our own network:
 * https on the default port only, every resolved address checked against the blocklist,
 * the connection pinned to the address that was checked (no DNS rebinding in between),
 * no redirects followed, a hard timeout, a size cap, and JSON only.
 */
export class SafeFetcher {
  private static readonly blocklist = SafeFetcher.buildBlockedAddressList();

  private readonly timeout_ms: number;
  private readonly max_bytes: number;
  private readonly resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  private readonly send: (target: SafeFetchTarget) => Promise<SafeFetchResponse>;

  constructor(opts: SafeFetcherOptions = {}) {
    this.timeout_ms = opts.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    this.max_bytes = opts.max_bytes ?? DEFAULT_MAX_BYTES;
    this.resolve = opts.resolve ?? SafeFetcher.lookupAllHostAddresses;
    this.send = opts.send ?? SafeFetcher.fetchHttpsResponse;
  }

  static isBlockedAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 0) return true;
    return SafeFetcher.blocklist.check(address, family === 4 ? 'ipv4' : 'ipv6');
  }

  async fetchJsonDocument(raw_url: string): Promise<{ json: unknown; cache_control?: string }> {
    const url = SafeFetcher.parseFetchUrl(raw_url);
    const address = await this.resolvePublicAddress(url.hostname);
    const response = await this.send({
      hostname: url.hostname,
      address,
      path: `${url.pathname}${url.search}`,
      timeout_ms: this.timeout_ms,
      max_bytes: this.max_bytes
    });

    if (response.status >= 300 && response.status < 400) {
      throw new SafeFetchError('redirect_not_allowed', 'Redirects are not followed');
    }
    if (response.status !== 200) throw new SafeFetchError('bad_status', `Unexpected status ${response.status}`);
    if (Buffer.byteLength(response.body) > this.max_bytes) throw new SafeFetchError('too_large', 'Response is too large');

    const content_type = SafeFetcher.getResponseHeader(response, 'content-type') ?? '';
    if (!/^application\/([\w.+-]+\+)?json\b/i.test(content_type)) {
      throw new SafeFetchError('not_json', 'Response is not JSON');
    }

    try {
      return { json: JSON.parse(response.body), cache_control: SafeFetcher.getResponseHeader(response, 'cache-control') };
    } catch {
      throw new SafeFetchError('not_json', 'Response is not valid JSON');
    }
  }

  private static parseFetchUrl(raw_url: string): URL {
    let url: URL;
    try {
      url = new URL(raw_url);
    } catch {
      throw new SafeFetchError('invalid_url', 'Not a URL');
    }
    if (url.protocol !== 'https:') throw new SafeFetchError('not_https', 'Only https URLs are fetched');
    if (url.port !== '' && url.port !== '443') throw new SafeFetchError('port_not_allowed', 'Only the default https port is allowed');
    if (url.username || url.password) throw new SafeFetchError('credentials_in_url', 'URLs with credentials are refused');
    return url;
  }

  /** Any blocked record refuses the whole host, so a mixed public/private answer cannot slip through. */
  private async resolvePublicAddress(hostname: string): Promise<ResolvedAddress> {
    const literal = hostname.replace(/^\[|\]$/g, '');
    const literal_family = isIP(literal);
    const addresses: ResolvedAddress[] =
      literal_family !== 0 ? [{ address: literal, family: literal_family as 4 | 6 }] : await this.resolveHostAddresses(hostname);

    if (addresses.length === 0) throw new SafeFetchError('unresolvable', 'Host did not resolve');
    if (addresses.some((a) => SafeFetcher.isBlockedAddress(a.address))) {
      throw new SafeFetchError('blocked_address', 'Host resolves to a non-public address');
    }
    return addresses[0];
  }

  private async resolveHostAddresses(hostname: string): Promise<ResolvedAddress[]> {
    try {
      return await this.resolve(hostname);
    } catch {
      throw new SafeFetchError('unresolvable', 'Host did not resolve');
    }
  }

  private static async lookupAllHostAddresses(hostname: string): Promise<ResolvedAddress[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
  }

  private static fetchHttpsResponse(target: SafeFetchTarget): Promise<SafeFetchResponse> {
    return new Promise((resolve, reject) => {
      // Connects to the vetted address while TLS still verifies the certificate for the hostname.
      const pinned_lookup: LookupFunction = (_hostname, options, callback) => {
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (err: null, addresses: { address: string; family: number }[]) => void)(null, [target.address]);
          return;
        }
        callback(null, target.address.address, target.address.family);
      };

      const req = https.get(
        {
          host: target.hostname,
          servername: target.hostname,
          path: target.path,
          headers: { accept: 'application/json', 'user-agent': USER_AGENT },
          lookup: pinned_lookup,
          timeout: target.timeout_ms
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > target.max_bytes) {
              req.destroy(new SafeFetchError('too_large', 'Response is too large'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', (err) => reject(SafeFetcher.toSafeFetchError(err)));
        }
      );
      req.on('timeout', () => req.destroy(new SafeFetchError('timeout', 'Request timed out')));
      req.on('error', (err) => reject(SafeFetcher.toSafeFetchError(err)));
    });
  }

  private static toSafeFetchError(err: unknown): SafeFetchError {
    return err instanceof SafeFetchError ? err : new SafeFetchError('network', (err as Error)?.message ?? 'Network error');
  }

  private static getResponseHeader(response: SafeFetchResponse, name: string): string | undefined {
    const value = response.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private static buildBlockedAddressList(): BlockList {
    const list = new BlockList();
    for (const [network, prefix, type] of BLOCKED_SUBNETS) list.addSubnet(network, prefix, type);
    return list;
  }
}
