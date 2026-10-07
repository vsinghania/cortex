/*
 * SafeFetcher's refusals, with DNS and the transport injected so no test touches the network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SafeFetchError, SafeFetcher, type ResolvedAddress, type SafeFetchResponse, type SafeFetchTarget } from '../src/lib/net/safe_fetcher.js';

const PUBLIC: ResolvedAddress = { address: '93.184.216.34', family: 4 };
const OK_JSON: SafeFetchResponse = { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' };

function fetcher(opts: { addresses?: ResolvedAddress[]; response?: SafeFetchResponse; seen?: SafeFetchTarget[] } = {}) {
  return new SafeFetcher({
    resolve: async () => opts.addresses ?? [PUBLIC],
    send: async (target) => {
      opts.seen?.push(target);
      return opts.response ?? OK_JSON;
    }
  });
}

async function refuses(promise: Promise<unknown>, reason: SafeFetchError['reason']) {
  await assert.rejects(promise, (err: unknown) => err instanceof SafeFetchError && err.reason === reason);
}

test('fetches JSON and connects to the address it vetted', async () => {
  const seen: SafeFetchTarget[] = [];
  const result = await fetcher({ seen }).getJson('https://claude.test/oauth/client.json?v=1');
  assert.deepEqual(result.json, { ok: true });
  assert.equal(seen[0].hostname, 'claude.test');
  assert.equal(seen[0].address.address, PUBLIC.address);
  assert.equal(seen[0].path, '/oauth/client.json?v=1');
});

test('refuses anything but https on the default port, and URLs with credentials', async () => {
  await refuses(fetcher().getJson('http://claude.test/c.json'), 'not_https');
  await refuses(fetcher().getJson('https://claude.test:8443/c.json'), 'port_not_allowed');
  await refuses(fetcher().getJson('https://user:pw@claude.test/c.json'), 'credentials_in_url');
  await refuses(fetcher().getJson('not a url'), 'invalid_url');
});

test('refuses hosts that resolve to loopback, private, link-local or metadata addresses', async () => {
  for (const address of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
    await refuses(fetcher({ addresses: [{ address, family: 4 }] }).getJson('https://evil.test/c.json'), 'blocked_address');
  }
  for (const address of ['::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::a00:1']) {
    await refuses(fetcher({ addresses: [{ address, family: 6 }] }).getJson('https://evil.test/c.json'), 'blocked_address');
  }
});

test('one private record among public ones refuses the whole host', async () => {
  await refuses(
    fetcher({ addresses: [PUBLIC, { address: '10.0.0.1', family: 4 }] }).getJson('https://rebind.test/c.json'),
    'blocked_address'
  );
});

test('refuses IP-literal hosts in blocked ranges without resolving', async () => {
  await refuses(fetcher().getJson('https://127.0.0.1/c.json'), 'blocked_address');
  await refuses(fetcher().getJson('https://[::1]/c.json'), 'blocked_address');
});

test('does not follow redirects, and refuses bad statuses, non-JSON and oversized bodies', async () => {
  await refuses(fetcher({ response: { status: 302, headers: { location: 'http://169.254.169.254/' }, body: '' } }).getJson('https://a.test/c.json'), 'redirect_not_allowed');
  await refuses(fetcher({ response: { status: 404, headers: {}, body: '' } }).getJson('https://a.test/c.json'), 'bad_status');
  await refuses(fetcher({ response: { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>' } }).getJson('https://a.test/c.json'), 'not_json');
  await refuses(fetcher({ response: { status: 200, headers: { 'content-type': 'application/json' }, body: '{bad' } }).getJson('https://a.test/c.json'), 'not_json');
  const huge = JSON.stringify({ pad: 'x'.repeat(70 * 1024) });
  await refuses(fetcher({ response: { status: 200, headers: { 'content-type': 'application/json' }, body: huge } }).getJson('https://a.test/c.json'), 'too_large');
});

test('isBlockedAddress agrees with public and private examples', () => {
  assert.equal(SafeFetcher.isBlockedAddress('8.8.8.8'), false);
  assert.equal(SafeFetcher.isBlockedAddress('2606:4700:4700::1111'), false);
  assert.equal(SafeFetcher.isBlockedAddress('192.168.0.1'), true);
  assert.equal(SafeFetcher.isBlockedAddress('not-an-ip'), true);
});
