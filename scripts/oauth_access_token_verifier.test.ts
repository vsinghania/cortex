/*
 * The authorization server's half of the resource-server contract, over in-memory stores.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OAuthAccessTokenVerifier } from '../src/oauth_svc/oauth_access_token_verifier.js';
import { Time } from '../src/lib/time.js';
import { InMemoryOAuthStores } from './support/in_memory_oauth_stores.js';

const RESOURCE = 'https://api.cortex.test/mcp';

async function harness(scopes = ['notes:read', 'notes:write']) {
  const { stores, repos } = InMemoryOAuthStores.create();
  const clock = { now: new Date('2026-10-07T10:00:00Z') };
  const verifier = new OAuthAccessTokenVerifier({ stores: async () => stores, now: () => clock.now });
  const grant = await stores.grants.upsertGrant({
    user_id: 'u-1',
    client_id: 'https://claude.test/c.json',
    client_name: 'Claude',
    kind: 'external',
    scopes,
    resource: RESOURCE
  });
  const issued = await stores.tokens.issueTokens({ grant, scopes, now: clock.now, with_refresh: true });
  return { stores, repos, verifier, grant, issued, clock };
}

test('a live access token verifies as its grant\'s user, client, scopes and resource', async () => {
  const { verifier, grant, issued } = await harness();
  assert.deepEqual(await verifier.verifyAccessToken(issued.access.value), {
    user_id: 'u-1',
    client_id: 'https://claude.test/c.json',
    grant_id: grant.grant_id,
    scopes: ['notes:read', 'notes:write'],
    resource: RESOURCE,
    kind: 'external'
  });
});

test('unknown, refresh, expired and revoked tokens do not verify', async () => {
  const { verifier, issued, stores, clock } = await harness();
  assert.equal(await verifier.verifyAccessToken('cx_at_unknown'), null);
  assert.equal(await verifier.verifyAccessToken(issued.refresh!.value), null, 'a refresh token is not an access token');

  await stores.tokens.revokeTokenFamily({ family_id: issued.family_id, now: clock.now });
  assert.equal(await verifier.verifyAccessToken(issued.access.value), null);

  const fresh = await harness();
  fresh.clock.now = new Date(fresh.clock.now.getTime() + Time.hoursToMs(1) + 1);
  assert.equal(await fresh.verifier.verifyAccessToken(fresh.issued.access.value), null);
});

test('deleting its grant ends the token', async () => {
  const { verifier, grant, issued, stores } = await harness();
  await stores.grants.deleteExternalGrantForUser({ user_id: 'u-1', grant_id: grant.grant_id });
  assert.equal(await verifier.verifyAccessToken(issued.access.value), null);
});

test('effective scopes are what both the token and the current grant allow', async () => {
  const { verifier, grant, issued, stores } = await harness();
  await stores.grants.upsertGrant({ ...grant, scopes: ['notes:read'] });
  assert.deepEqual((await verifier.verifyAccessToken(issued.access.value))?.scopes, ['notes:read']);
});

test('use is recorded on the grant', async () => {
  const { verifier, issued, repos } = await harness();
  await verifier.verifyAccessToken(issued.access.value);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(repos.grants.rows[0].last_used_at);
});
