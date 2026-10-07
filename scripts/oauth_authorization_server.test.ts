/*
 * The OAuth authorization server end to end, minus HTTP and Mongo: OAuthAuthorizationServer,
 * OAuthSvc (consent), OAuthAccessTokenVerifier and the CIMD resolver are the real code. The
 * client's metadata document is served through SafeFetcher's injectable DNS and transport.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { OAuthAuthorizationServer } from '../src/oauth_svc/oauth_authorization_server.js';
import { OAuthSvc } from '../src/oauth_svc/oauth_svc.js';
import { OAuthAccessTokenVerifier } from '../src/oauth_svc/oauth_access_token_verifier.js';
import { ClientIdMetadataResolver } from '../src/oauth_svc/clients/client_id_metadata_resolver.js';
import { OAuthProtocolError } from '../src/oauth_svc/oauth_errors.js';
import { OAuthConfigLoader, type OAuthConfig } from '../src/oauth_svc/config/oauth_config.js';
import { SafeFetcher, type SafeFetchTarget } from '../src/lib/net/safe_fetcher.js';
import { Time } from '../src/lib/time.js';
import { InMemoryOAuthStores } from './support/in_memory_oauth_stores.js';
import { McpResourceCatalog } from '../src/mcp/resource/mcp_resource_catalog.js';
import type { McpResourceDefinition } from '../src/mcp/resource/mcp_resource.types.js';

const CONFIG: OAuthConfig = {
  issuer_url: new URL('https://api.cortex.test'),
  app_public_url: new URL('https://cortex.test')
};
const ISSUER = 'https://api.cortex.test';
const RESOURCE = 'https://mcp.cortex.test/notes';
const ARTICLES = 'https://mcp.cortex.test/articles';

/** A second, test-only MCP server, to prove nothing assumes there is just one. */
const ARTICLES_DEF = {
  id: 'articles',
  path: '/articles',
  display_name: 'Articles',
  scopes: { read: 'articles:read', write: 'articles:write' },
  access_copy: { read: 'Read your articles.', read_write: 'Also edit your articles.' },
  internal_url_env: 'MCP_ARTICLES_INTERNAL_URL',
  assertion_audience: 'cortex-articles-mcp'
} as unknown as McpResourceDefinition;

const RESOURCES = McpResourceCatalog.create({
  base_url: new URL('https://mcp.cortex.test'),
  definitions: [...McpResourceCatalog.DEFINITIONS, ARTICLES_DEF],
  env: { MCP_NOTES_INTERNAL_URL: 'http://notes:3010/mcp', MCP_ARTICLES_INTERNAL_URL: 'http://articles:3020/mcp' } as NodeJS.ProcessEnv
});
const CLIENT_ID = 'https://chatgpt.test/oauth/client.json';
const REDIRECT = 'https://chatgpt.test/callback';
const USER_ID = 'user-1';

const DOCUMENTS: Record<string, unknown> = {
  [CLIENT_ID]: {
    client_id: CLIENT_ID,
    client_name: 'ChatGPT',
    redirect_uris: [REDIRECT, 'http://127.0.0.1:3333/cb'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token']
  },
  'https://noreresh.test/client.json': {
    client_id: 'https://noreresh.test/client.json',
    client_name: 'One-shot',
    redirect_uris: ['https://noreresh.test/cb'],
    grant_types: ['authorization_code']
  },
  'https://liar.test/client.json': {
    client_id: 'https://someone-else.test/client.json',
    client_name: 'Liar',
    redirect_uris: ['https://liar.test/cb']
  }
};

function fetcher(): SafeFetcher {
  return new SafeFetcher({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    send: async (target: SafeFetchTarget) => {
      const doc = DOCUMENTS[`https://${target.hostname}${target.path}`];
      return doc
        ? { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) }
        : { status: 404, headers: {}, body: '' };
    }
  });
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function harness() {
  const stores = InMemoryOAuthStores.create();
  const clock = { now: new Date('2026-10-06T10:00:00Z') };
  const now = () => clock.now;
  const server = new OAuthAuthorizationServer({
    stores: async () => stores,
    clients: new ClientIdMetadataResolver(fetcher()),
    config: CONFIG,
    resources: RESOURCES,
    now
  });
  const svc = await OAuthSvc.create({ stores, config: CONFIG, resources: RESOURCES, now });
  const verifier = new OAuthAccessTokenVerifier({ stores: async () => stores, now });
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { stores, server, svc, verifier, advance };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function startAuthorization(h: Harness, overrides: Record<string, string | undefined> = {}) {
  const { verifier, challenge } = pkce();
  const url = await h.server.authorize({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-1',
    scope: 'notes:read notes:write',
    resource: RESOURCE,
    ...overrides
  });
  return { url: new URL(url), verifier };
}

async function connect(h: Harness, access: 'read' | 'read_write' = 'read_write', resource = RESOURCE) {
  const scope = resource === RESOURCE ? 'notes:read notes:write' : 'articles:read articles:write';
  const { url, verifier } = await startAuthorization(h, { resource, scope });
  const request_id = url.searchParams.get('request')!;
  const { redirect_url } = await h.svc.approve({ request_id, user_id: USER_ID, access });
  const code = new URL(redirect_url).searchParams.get('code')!;
  const tokens = await h.server.token({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    resource
  });
  return { tokens, code, verifier, redirect_url };
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => err instanceof OAuthProtocolError && err.code === code);
}

test('the authorization server needs only its issuer and the consent page origin', () => {
  assert.equal(OAuthConfigLoader.fromEnv({}), null);
  assert.equal(OAuthConfigLoader.fromEnv({ OAUTH_ISSUER_URL: '', APP_PUBLIC_URL: '' }), null);
  assert.throws(() => OAuthConfigLoader.fromEnv({ OAUTH_ISSUER_URL: ISSUER }), /APP_PUBLIC_URL/);
  const config = OAuthConfigLoader.fromEnv({ OAUTH_ISSUER_URL: ISSUER, APP_PUBLIC_URL: 'https://cortex.test' });
  assert.equal(config?.issuer_url.href, `${ISSUER}/`);
});

test('metadata advertises CIMD, iss, S256 and public clients, and no registration endpoint', async () => {
  const { server } = await harness();
  const metadata = server.metadata();
  assert.equal(metadata.issuer, ISSUER);
  assert.equal(metadata.client_id_metadata_document_supported, true);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
  assert.equal('registration_endpoint' in metadata, false);
  assert.deepEqual(metadata.scopes_supported, ['notes:read', 'notes:write', 'articles:read', 'articles:write']);
});

test('authorize parks the request and the consent page shows the verifiable client host', async () => {
  const h = await harness();
  const { url } = await startAuthorization(h);
  assert.equal(`${url.origin}${url.pathname}`, 'https://cortex.test/connect');
  const view = await h.svc.describeRequest(url.searchParams.get('request')!);
  assert.equal(view.client_name, 'ChatGPT');
  assert.equal(view.client_host, 'chatgpt.test');
  assert.equal(view.redirect_host, 'chatgpt.test');
  assert.deepEqual(view.resource, { id: 'notes', name: 'Notes' });
  assert.deepEqual(view.requested_scopes, ['notes:read', 'notes:write']);
  assert.deepEqual(
    view.access_options.map((o) => [o.value, o.available, o.detail]),
    [
      ['read', true, 'Search and read your notes and folders.'],
      ['read_write', true, 'Also create, edit, organise and delete notes.']
    ]
  );
  assert.equal(view.default_access, 'read_write');
});

test('a client that asks only to read sees read & write offered but unavailable', async () => {
  const h = await harness();
  const { url } = await startAuthorization(h, { scope: 'notes:read' });
  const view = await h.svc.describeRequest(url.searchParams.get('request')!);
  assert.equal(view.access_options.find((o) => o.value === 'read_write')?.available, false);
  assert.equal(view.default_access, 'read');
});

test('the resource is required and must be one of ours', async () => {
  const h = await harness();
  for (const resource of [undefined, 'https://evil.test/mcp', 'https://api.cortex.test/notes']) {
    const url = new URL((await startAuthorization(h, { resource })).url);
    assert.equal(url.searchParams.get('error'), 'invalid_target', String(resource));
    assert.equal(url.searchParams.get('iss'), ISSUER);
  }
});

test('scopes are per resource: another resource\'s scopes are dropped from a request', async () => {
  const h = await harness();
  const { url } = await startAuthorization(h, { resource: ARTICLES, scope: 'notes:write articles:read' });
  const view = await h.svc.describeRequest(url.searchParams.get('request')!);
  assert.deepEqual(view.resource, { id: 'articles', name: 'Articles' });
  assert.deepEqual(view.requested_scopes, ['articles:read']);
});

test('one app connected to two resources holds two grants, revoked independently', async () => {
  const h = await harness();
  const notes = await connect(h, 'read_write', RESOURCE);
  const articles = await connect(h, 'read', ARTICLES);
  assert.equal(h.stores.grants.rows.length, 2);

  const notes_token = await h.verifier.verify(notes.tokens.access_token);
  const articles_token = await h.verifier.verify(articles.tokens.access_token);
  assert.equal(notes_token?.resource, RESOURCE);
  assert.deepEqual(notes_token?.scopes, ['notes:read', 'notes:write']);
  assert.equal(articles_token?.resource, ARTICLES);
  assert.deepEqual(articles_token?.scopes, ['articles:read']);

  const listed = await h.svc.listGrants(USER_ID);
  assert.deepEqual(listed.map((g) => g.resource_name).sort(), ['Articles', 'Notes']);
  await h.svc.revokeGrant({ user_id: USER_ID, grant_id: listed.find((g) => g.resource_id === 'articles')!.grant_id });
  assert.equal(await h.verifier.verify(articles.tokens.access_token), null);
  assert.ok(await h.verifier.verify(notes.tokens.access_token));
});

test('Settings lists every enabled resource with the URL to paste', async () => {
  const h = await harness();
  assert.deepEqual(h.svc.listResources(), [
    { id: 'notes', name: 'Notes', url: RESOURCE },
    { id: 'articles', name: 'Articles', url: ARTICLES }
  ]);
});

test('an untrustworthy client or redirect is refused without redirecting anywhere', async () => {
  const h = await harness();
  await rejectsWith(startAuthorization(h, { client_id: 'chatgpt' }), 'invalid_client');
  await rejectsWith(startAuthorization(h, { client_id: 'https://unknown.test/client.json' }), 'invalid_client');
  await rejectsWith(startAuthorization(h, { client_id: 'https://liar.test/client.json', redirect_uri: 'https://liar.test/cb' }), 'invalid_client');
  await rejectsWith(startAuthorization(h, { redirect_uri: 'https://attacker.test/cb' }), 'invalid_request');
});

test('a loopback redirect may use any port', async () => {
  const h = await harness();
  const { url } = await startAuthorization(h, { redirect_uri: 'http://127.0.0.1:54321/cb' });
  assert.equal(url.pathname, '/connect');
});

test('request errors go back to the client with state and iss', async () => {
  const h = await harness();
  const missing_pkce = new URL((await startAuthorization(h, { code_challenge: undefined })).url);
  assert.equal(missing_pkce.searchParams.get('error'), 'invalid_request');
  assert.equal(missing_pkce.searchParams.get('state'), 'state-1');
  assert.equal(missing_pkce.searchParams.get('iss'), ISSUER);

  const wrong_resource = new URL((await startAuthorization(h, { resource: 'https://evil.test/mcp' })).url);
  assert.equal(wrong_resource.searchParams.get('error'), 'invalid_target');
});

test('approve redirects with code, state and iss; the token verifies as the user for this resource', async () => {
  const h = await harness();
  const { tokens, redirect_url } = await connect(h);
  const back = new URL(redirect_url);
  assert.equal(back.searchParams.get('state'), 'state-1');
  assert.equal(back.searchParams.get('iss'), ISSUER);
  assert.match(tokens.access_token, /^cx_at_/);
  assert.match(tokens.refresh_token!, /^cx_rt_/);
  assert.equal(tokens.scope, 'notes:read notes:write');

  const verified = await h.verifier.verify(tokens.access_token);
  assert.deepEqual(verified, {
    user_id: USER_ID,
    client_id: CLIENT_ID,
    grant_id: h.stores.grants.rows[0].grant_id,
    scopes: ['notes:read', 'notes:write'],
    resource: RESOURCE,
    kind: 'external'
  });
});

test('a wrong code_verifier is refused', async () => {
  const h = await harness();
  const { url } = await startAuthorization(h);
  const { redirect_url } = await h.svc.approve({ request_id: url.searchParams.get('request')!, user_id: USER_ID, access: 'read' });
  const code = new URL(redirect_url).searchParams.get('code')!;
  await rejectsWith(h.server.token({ grant_type: 'authorization_code', code, code_verifier: pkce().verifier, client_id: CLIENT_ID }), 'invalid_grant');
});

test('replaying a code is refused and revokes the tokens it already produced', async () => {
  const h = await harness();
  const { tokens, code, verifier } = await connect(h);
  await rejectsWith(h.server.token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: CLIENT_ID }), 'invalid_grant');
  assert.equal(await h.verifier.verify(tokens.access_token), null);
});

test('a code expires after a minute', async () => {
  const h = await harness();
  const { url, verifier } = await startAuthorization(h);
  const { redirect_url } = await h.svc.approve({ request_id: url.searchParams.get('request')!, user_id: USER_ID, access: 'read' });
  h.advance(Time.minutesToMs(2));
  const code = new URL(redirect_url).searchParams.get('code')!;
  await rejectsWith(h.server.token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: CLIENT_ID }), 'invalid_grant');
});

test('refresh rotates within the family; a replay moments later is refused but harmless', async () => {
  const h = await harness();
  const { tokens } = await connect(h);
  const refreshed = await h.server.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLIENT_ID });
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token);
  h.advance(Time.secondsToMs(5));
  await rejectsWith(h.server.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLIENT_ID }), 'invalid_grant');
  assert.ok(await h.verifier.verify(refreshed.access_token));
});

test('a later replay revokes only that family: the same user on another device keeps working', async () => {
  const h = await harness();
  const laptop = await connect(h);
  const phone = await connect(h);
  assert.equal(h.stores.grants.rows.length, 1, 'one consent, two devices');

  const laptop_next = await h.server.token({ grant_type: 'refresh_token', refresh_token: laptop.tokens.refresh_token, client_id: CLIENT_ID });
  h.advance(Time.minutesToMs(5));
  await rejectsWith(h.server.token({ grant_type: 'refresh_token', refresh_token: laptop.tokens.refresh_token, client_id: CLIENT_ID }), 'invalid_grant');

  assert.equal(await h.verifier.verify(laptop_next.access_token), null);
  await rejectsWith(h.server.token({ grant_type: 'refresh_token', refresh_token: laptop_next.refresh_token, client_id: CLIENT_ID }), 'invalid_grant');
  assert.ok(await h.verifier.verify(phone.tokens.access_token));
});

test('a refresh may narrow scopes but never widen them', async () => {
  const h = await harness();
  const { tokens } = await connect(h, 'read');
  await rejectsWith(
    h.server.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLIENT_ID, scope: 'notes:write' }),
    'invalid_scope'
  );

  const full = await harness();
  const { tokens: full_tokens } = await connect(full, 'read_write');
  const narrowed = await full.server.token({ grant_type: 'refresh_token', refresh_token: full_tokens.refresh_token, client_id: CLIENT_ID, scope: 'notes:read' });
  assert.equal(narrowed.scope, 'notes:read');
});

test('a narrower re-consent narrows tokens already issued under the grant', async () => {
  const h = await harness();
  const first = await connect(h, 'read_write');
  await connect(h, 'read');
  const verified = await h.verifier.verify(first.tokens.access_token);
  assert.deepEqual(verified?.scopes, ['notes:read']);
});

test('disconnecting in Settings ends every token at once, and only for the owner', async () => {
  const h = await harness();
  const laptop = await connect(h);
  const phone = await connect(h);
  const [grant] = await h.svc.listGrants(USER_ID);
  assert.equal(grant.client_host, 'chatgpt.test');
  assert.equal(Object.keys(grant).some((key) => key.includes('hash') || key.includes('token')), false);

  await assert.rejects(h.svc.revokeGrant({ user_id: 'someone-else', grant_id: grant.grant_id }), /not found/i);
  await h.svc.revokeGrant({ user_id: USER_ID, grant_id: grant.grant_id });
  assert.equal(await h.verifier.verify(laptop.tokens.access_token), null);
  assert.equal(await h.verifier.verify(phone.tokens.access_token), null);
  await rejectsWith(h.server.token({ grant_type: 'refresh_token', refresh_token: phone.tokens.refresh_token, client_id: CLIENT_ID }), 'invalid_grant');
});

test('RFC 7009 revocation by the client revokes that token family', async () => {
  const h = await harness();
  const { tokens } = await connect(h);
  await h.server.revoke({ token: tokens.refresh_token, client_id: CLIENT_ID });
  assert.equal(await h.verifier.verify(tokens.access_token), null);
});

test('access tokens expire after an hour', async () => {
  const h = await harness();
  const { tokens } = await connect(h);
  h.advance(Time.hoursToMs(1) + 1);
  assert.equal(await h.verifier.verify(tokens.access_token), null);
});

test('a client that does not declare refresh_token gets no refresh token', async () => {
  const h = await harness();
  const { verifier, challenge } = pkce();
  const url = new URL(
    await h.server.authorize({
      client_id: 'https://noreresh.test/client.json',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE
    })
  );
  const { redirect_url } = await h.svc.approve({ request_id: url.searchParams.get('request')!, user_id: USER_ID, access: 'read' });
  const tokens = await h.server.token({
    grant_type: 'authorization_code',
    code: new URL(redirect_url).searchParams.get('code')!,
    code_verifier: verifier,
    client_id: 'https://noreresh.test/client.json'
  });
  assert.equal(tokens.refresh_token, undefined);
});

test('unsupported grant types are refused', async () => {
  const h = await harness();
  await rejectsWith(h.server.token({ grant_type: 'client_credentials', client_id: CLIENT_ID }), 'unsupported_grant_type');
});
