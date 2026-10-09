/*
 * Client ID Metadata Document validation: what makes a document an acceptable client.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ClientIdMetadataResolver } from '../src/oauth_svc/clients/client_id_metadata_resolver.js';
import { OAuthProtocolError } from '../src/oauth_svc/oauth_errors.js';
import { SafeFetcher } from '../src/lib/net/safe_fetcher.js';

const CLIENT_ID = 'https://claude.test/oauth/client.json';

function resolverServing(doc: unknown, headers: Record<string, string> = {}, counter = { calls: 0 }) {
  return new ClientIdMetadataResolver(
    new SafeFetcher({
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      send: async () => {
        counter.calls += 1;
        return { status: 200, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(doc) };
      }
    })
  );
}

const VALID = { client_id: CLIENT_ID, client_name: 'Claude', redirect_uris: ['https://claude.test/api/mcp/auth_callback'] };

async function invalidClient(promise: Promise<unknown>) {
  await assert.rejects(promise, (err: unknown) => err instanceof OAuthProtocolError && err.code === 'invalid_client');
}

test('resolves a valid document, with the client_id host as the verifiable identity', async () => {
  const client = await resolverServing(VALID).resolveClientMetadata(CLIENT_ID);
  assert.equal(client.client_name, 'Claude');
  assert.equal(client.client_host, 'claude.test');
  assert.equal(client.allows_refresh, true);
});

test('client_id must be an https URL with a path and nothing ambiguous', async () => {
  const resolver = resolverServing(VALID);
  for (const bad of ['claude', 'http://claude.test/c.json', 'https://claude.test', 'https://claude.test/', 'https://claude.test/c.json#x', 'https://u:p@claude.test/c.json', 'https://claude.test/a/../c.json']) {
    await invalidClient(resolver.resolveClientMetadata(bad));
  }
});

test('the document must name itself, list redirect URIs, and be a public client', async () => {
  await invalidClient(resolverServing({ ...VALID, client_id: 'https://other.test/c.json' }).resolveClientMetadata(CLIENT_ID));
  await invalidClient(resolverServing({ client_id: CLIENT_ID, client_name: 'Claude' }).resolveClientMetadata(CLIENT_ID));
  await invalidClient(resolverServing({ ...VALID, client_name: undefined }).resolveClientMetadata(CLIENT_ID));
  await invalidClient(resolverServing({ ...VALID, token_endpoint_auth_method: 'private_key_jwt' }).resolveClientMetadata(CLIENT_ID));
  await invalidClient(resolverServing({ ...VALID, grant_types: ['client_credentials'] }).resolveClientMetadata(CLIENT_ID));
  await invalidClient(resolverServing({ ...VALID, redirect_uris: ['http://attacker.test/cb'] }).resolveClientMetadata(CLIENT_ID));
});

test('a client preferring private_key_jwt is accepted only if it also supports acting as a public client', async () => {
  const chatgpt_style = {
    ...VALID,
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    token_endpoint_auth_signing_alg: 'RS256',
    jwks_uri: 'https://claude.test/oauth/jwks.json'
  };
  assert.equal((await resolverServing(chatgpt_style).resolveClientMetadata(CLIENT_ID)).client_name, 'Claude');
  await invalidClient(resolverServing({ ...chatgpt_style, token_endpoint_auth_methods_supported: ['private_key_jwt'] }).resolveClientMetadata(CLIENT_ID));
  await invalidClient(resolverServing({ ...VALID, token_endpoint_auth_method: 'client_secret_basic' }).resolveClientMetadata(CLIENT_ID));
});

test('caches per Cache-Control, and not at all for no-store', async () => {
  const cached = { calls: 0 };
  const resolver = resolverServing(VALID, { 'cache-control': 'max-age=600' }, cached);
  await resolver.resolveClientMetadata(CLIENT_ID);
  await resolver.resolveClientMetadata(CLIENT_ID);
  assert.equal(cached.calls, 1);

  const uncached = { calls: 0 };
  const fresh = resolverServing(VALID, { 'cache-control': 'no-store' }, uncached);
  await fresh.resolveClientMetadata(CLIENT_ID);
  await fresh.resolveClientMetadata(CLIENT_ID);
  assert.equal(uncached.calls, 2);
});

test('a fetch the SafeFetcher refuses becomes invalid_client', async () => {
  const resolver = new ClientIdMetadataResolver(new SafeFetcher({ resolve: async () => [{ address: '169.254.169.254', family: 4 }] }));
  await invalidClient(resolver.resolveClientMetadata(CLIENT_ID));
});
