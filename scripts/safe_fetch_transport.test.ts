import assert from 'node:assert/strict';
import test from 'node:test';
import { SafeFetcher, SafeFetchError, type ResolvedAddress } from '../src/lib/net/safe_fetcher.js';
import { HttpsFixture } from './support/https_fixture.js';

const PUBLIC: ResolvedAddress = { address: '93.184.216.34', family: 4 };

function isFailure(reason: SafeFetchError['reason']) {
  return (err: unknown) => err instanceof SafeFetchError && err.reason === reason;
}

test('default HTTPS transport pins DNS while keeping TLS hostname verification and reading chunks', async (t) => {
  const { seen_options } = await HttpsFixture.create(t, (req, res) => {
    assert.equal(req.url, '/client.json?v=1');
    assert.equal(req.headers.accept, 'application/json');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' });
    res.write('{"ok":');
    res.end('true}');
  });
  let resolutions = 0;
  const fetcher = new SafeFetcher({ resolve: async () => { resolutions++; return [PUBLIC]; } });
  assert.deepEqual(await fetcher.fetchJsonDocument('https://client.test/client.json?v=1'), { json: { ok: true }, cache_control: 'max-age=60' });
  assert.equal(resolutions, 1);
  assert.equal(seen_options.length, 1);
  const lookup = seen_options[0].lookup!;
  lookup('changed.test', { family: 0, hints: 0, all: false }, (err, address, family) => {
    assert.equal(err, null);
    assert.equal(address, PUBLIC.address);
    assert.equal(family, 4);
  });
  lookup('changed.test', { family: 0, hints: 0, all: true }, (err, addresses) => {
    assert.equal(err, null);
    assert.deepEqual(addresses, [PUBLIC]);
  });
});

test('default HTTPS transport aborts a response exceeding its byte cap across chunks', async (t) => {
  await HttpsFixture.create(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"text":"');
    res.end('é'.repeat(30) + '"}');
  });
  const fetcher = new SafeFetcher({ max_bytes: 40, resolve: async () => [PUBLIC] });
  await assert.rejects(fetcher.fetchJsonDocument('https://client.test/c.json'), isFailure('too_large'));
});

test('default HTTPS transport times out a stalled response', async (t) => {
  await HttpsFixture.create(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{');
  });
  const fetcher = new SafeFetcher({ timeout_ms: 100, resolve: async () => [PUBLIC] });
  await assert.rejects(fetcher.fetchJsonDocument('https://client.test/c.json'), isFailure('timeout'));
});

test('default HTTPS transport rejects a certificate for another hostname', async (t) => {
  await HttpsFixture.create(t, (_req, res) => res.end('{}'));
  const fetcher = new SafeFetcher({ resolve: async () => [PUBLIC] });
  await assert.rejects(fetcher.fetchJsonDocument('https://other.test/c.json'), (err: unknown) => {
    assert.ok(err instanceof SafeFetchError);
    assert.equal(err.reason, 'network');
    assert.match(err.message, /Hostname\/IP does not match/);
    return true;
  });
});

test('default HTTPS transport never follows a redirect', async (t) => {
  let requests = 0;
  await HttpsFixture.create(t, (_req, res) => {
    requests++;
    res.writeHead(302, { Location: 'https://client.test/elsewhere' });
    res.end();
  });
  const fetcher = new SafeFetcher({ resolve: async () => [PUBLIC] });
  await assert.rejects(fetcher.fetchJsonDocument('https://client.test/c.json'), isFailure('redirect_not_allowed'));
  assert.equal(requests, 1);
});
