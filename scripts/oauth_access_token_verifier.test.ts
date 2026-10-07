/*
 * The authorization server's half of the resource-server contract, over in-memory stores.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OAuthAccessTokenVerifier } from '../src/oauth_svc/oauth_access_token_verifier.js';
import { OAuthTokenFamilies } from '../src/oauth_svc/oauth_token_families.js';
import { Time } from '../src/lib/time.js';
import { InMemoryOAuthStores } from './support/in_memory_oauth_stores.js';

const RESOURCE = 'https://api.cortex.test/mcp';

async function harness(scopes = ['notes:read', 'notes:write']) {
  const stores = InMemoryOAuthStores.create();
  const clock = { now: new Date('2026-10-07T10:00:00Z') };
  const verifier = new OAuthAccessTokenVerifier({ stores: async () => stores, now: () => clock.now });
  const grant = await stores.grants.upsert({
    grant_id: 'g-1',
    user_id: 'u-1',
    client_id: 'https://claude.test/c.json',
    client_name: 'Claude',
    kind: 'external',
    scopes,
    resource: RESOURCE
  });
  const families = new OAuthTokenFamilies(stores.tokens);
  const issued = await families.start({ grant, scopes, now: clock.now, with_refresh: true });
  return { stores, verifier, issued, clock };
}

test('a live access token verifies as its grant\'s user, client, scopes and resource', async () => {
  const { verifier, issued } = await harness();
  assert.deepEqual(await verifier.verify(issued.access.value), {
    user_id: 'u-1',
    client_id: 'https://claude.test/c.json',
    grant_id: 'g-1',
    scopes: ['notes:read', 'notes:write'],
    resource: RESOURCE,
    kind: 'external'
  });
});

test('unknown, refresh, expired and revoked tokens do not verify', async () => {
  const { verifier, issued, stores, clock } = await harness();
  assert.equal(await verifier.verify('cx_at_unknown'), null);
  assert.equal(await verifier.verify(issued.refresh!.value), null, 'a refresh token is not an access token');

  await stores.tokens.revokeFamily({ family_id: issued.family_id, now: clock.now });
  assert.equal(await verifier.verify(issued.access.value), null);

  const fresh = await harness();
  fresh.clock.now = new Date(fresh.clock.now.getTime() + Time.hoursToMs(1) + 1);
  assert.equal(await fresh.verifier.verify(fresh.issued.access.value), null);
});

test('deleting its grant ends the token', async () => {
  const { verifier, issued, stores } = await harness();
  await stores.grants.deleteExternalForUser({ user_id: 'u-1', grant_id: 'g-1' });
  assert.equal(await verifier.verify(issued.access.value), null);
});

test('effective scopes are what both the token and the current grant allow', async () => {
  const { verifier, issued, stores } = await harness();
  await stores.grants.upsert({ ...stores.grants.rows[0], grant_id: 'ignored', scopes: ['notes:read'] });
  assert.deepEqual((await verifier.verify(issued.access.value))?.scopes, ['notes:read']);
});

test('use is recorded on the grant', async () => {
  const { verifier, issued, stores } = await harness();
  await verifier.verify(issued.access.value);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(stores.grants.rows[0].last_used_at);
});
