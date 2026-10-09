import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import { SafeFetchError } from './safe_fetch_error.js';
import type { ResolvedAddress, SafeFetchTarget, SafeFetchResponse } from './types/safe_fetch.types.js';

const USER_AGENT = 'Cortex-OAuth/1.0 (+https://cortexapp.me)';

export class SafeFetchTransport {
  public static fetchHttpsResponse(target: SafeFetchTarget): Promise<SafeFetchResponse> {
    return new Promise((resolve, reject) => {
      const req = https.get(SafeFetchTransport.buildHttpsRequestOptions(target), async (res) => {
        try {
          const body = await SafeFetchTransport.readBoundedResponseBody(res, target.max_bytes);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        } catch (err) {
          const error = SafeFetchTransport.toSafeFetchError(err);
          req.destroy(error);
          reject(error);
        }
      });
      req.on('timeout', () => req.destroy(new SafeFetchError('timeout', 'Request timed out')));
      req.on('error', (err) => reject(SafeFetchTransport.toSafeFetchError(err)));
    });
  }

  private static buildHttpsRequestOptions(target: SafeFetchTarget): https.RequestOptions {
    return {
      host: target.hostname,
      servername: target.hostname,
      path: target.path,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      lookup: SafeFetchTransport.createPinnedDnsLookup(target.address),
      timeout: target.timeout_ms
    };
  }

  /** Pin the connection to the vetted address; TLS still verifies the original hostname. */
  private static createPinnedDnsLookup(address: ResolvedAddress): LookupFunction {
    return (_hostname, options, callback) => {
      if (options.all) {
        // Node supports lookup({ all: true }); LookupFunction types only the single-address callback.
        const all_callback = callback as unknown as (err: null, addresses: ResolvedAddress[]) => void;
        all_callback(null, [address]);
      } else {
        callback(null, address.address, address.family);
      }
    };
  }

  private static readBoundedResponseBody(res: IncomingMessage, max_bytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size_bytes = 0;
      res.on('data', (chunk: Buffer) => {
        size_bytes += chunk.length;
        if (size_bytes > max_bytes) {
          reject(new SafeFetchError('too_large', 'Response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
  }

  private static toSafeFetchError(err: unknown): SafeFetchError {
    return err instanceof SafeFetchError ? err : new SafeFetchError('network', err instanceof Error ? err.message : 'Network error');
  }
}
