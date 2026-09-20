/*
 * OneNote connect/disconnect with in-memory stand-ins for Mongo and Microsoft.
 * OneNoteConnectionSvc and the real SecretBox are the code under test - sealing is
 * not faked, because "the row holds no plaintext" is one of the properties asserted.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OneNoteConnectionSvc } from '../src/onenote_svc/onenote_connection_svc.js';
import { OneNoteConfigLoader } from '../src/onenote_svc/config/onenote_config.js';
import { OneNoteReauthRequiredError } from '../src/onenote_svc/onenote_errors.js';
import {
  OneNoteConnectionStatus,
  type CreateOneNoteConnectionInput,
  type MicrosoftAccessToken,
  type MicrosoftSession,
  type OneNoteConnection
} from '../src/onenote_svc/types/onenote_connection.types.js';
import type { MicrosoftOAuthAdapterInterface } from '../src/onenote_svc/adapters/microsoft_oauth_adapter_interface.js';
import type { OneNoteConnectionRepository } from '../src/onenote_svc/repositories/onenote_connection_repository_interface.js';
import { SecretBox } from '../src/lib/crypto/secret_box.js';
import { UnauthorizedError } from '../src/common/errors.js';

const KEY = Buffer.alloc(32, 0x7e).toString('base64');
const USER_ID = 'user-1';
const TOKEN_CACHE = '{"RefreshToken":{"secret":"a-microsoft-refresh-token"}}';

const secret_box = SecretBox.fromEnv({
  SECRET_ENCRYPTION_KEYS: `k1:${KEY}`,
  SECRET_ENCRYPTION_ACTIVE_KEY_ID: 'k1'
});

class InMemoryConnectionRepo implements OneNoteConnectionRepository {
  constructor(readonly rows: OneNoteConnection[] = []) {}

  async findByUserId(user_id: string) {
    return this.rows.find((row) => row.user_id === user_id) ?? null;
  }

  async upsert(input: CreateOneNoteConnectionInput) {
    const existing = await this.findByUserId(input.user_id);
    const row: OneNoteConnection = {
      id: existing?.id ?? 'connection-1',
      user_id: input.user_id,
      microsoft_home_account_id: input.identity.home_account_id,
      microsoft_email: input.identity.email,
      microsoft_name: input.identity.name,
      token_cache_sealed: input.token_cache_sealed,
      scopes: input.scopes,
      // Reconnecting keeps whatever was already chosen, as the Mongo upsert does.
      selected_notebook_ids: existing?.selected_notebook_ids ?? [],
      status: OneNoteConnectionStatus.Connected,
      created_at: existing?.created_at ?? new Date(),
      updated_at: new Date()
    };
    if (existing) this.rows.splice(this.rows.indexOf(existing), 1, row);
    else this.rows.push(row);
    return row;
  }

  async updateTokenCache(params: { user_id: string; token_cache_sealed: string }) {
    const row = await this.findByUserId(params.user_id);
    if (row) row.token_cache_sealed = params.token_cache_sealed;
  }

  async updateSelectedNotebooks(params: { user_id: string; notebook_ids: string[] }) {
    const row = await this.findByUserId(params.user_id);
    if (row) row.selected_notebook_ids = params.notebook_ids;
    return row;
  }

  async updateStatus(params: { user_id: string; status: OneNoteConnectionStatus; last_error?: string }) {
    const row = await this.findByUserId(params.user_id);
    if (row) {
      row.status = params.status;
      row.last_error = params.last_error;
    }
  }

  async deleteByUserId(user_id: string) {
    const row = await this.findByUserId(user_id);
    if (!row) return false;
    this.rows.splice(this.rows.indexOf(row), 1);
    return true;
  }
}

class FakeMicrosoft implements MicrosoftOAuthAdapterInterface {
  exchanged_with?: { code: string; code_verifier: string };
  acquired_with?: { token_cache: string; home_account_id: string };

  constructor(
    private readonly on_acquire: () => Promise<MicrosoftAccessToken> = async () => ({
      access_token: 'access-1',
      token_cache: null
    })
  ) {}

  async buildAuthorizationUrl(params: { state: string }) {
    return { url: `https://login.microsoftonline.test/authorize?state=${params.state}`, code_verifier: 'verifier-1' };
  }

  async exchangeCode(params: { code: string; code_verifier: string }): Promise<MicrosoftSession> {
    this.exchanged_with = params;
    return {
      access_token: 'access-1',
      identity: { home_account_id: 'home-1', email: 'ada@example.com', name: 'Ada L' },
      scopes: ['Notes.Read', 'User.Read'],
      token_cache: TOKEN_CACHE
    };
  }

  async acquireAccessToken(params: { token_cache: string; home_account_id: string }) {
    this.acquired_with = params;
    return this.on_acquire();
  }
}

class FakeGraph {
  constructor(readonly notebooks = [{ id: 'nb-1', display_name: 'Personal' }, { id: 'nb-2', display_name: 'Work' }]) {}
  async listNotebooks() {
    return this.notebooks;
  }
  async listSections() {
    return [];
  }
  async listPages() {
    return { pages: [] };
  }
  async getPageContent() {
    return '';
  }
}

async function connect(
  overrides: { microsoft?: FakeMicrosoft; repo?: InMemoryConnectionRepo; graph?: FakeGraph } = {}
) {
  const connection_repo = overrides.repo ?? new InMemoryConnectionRepo();
  const microsoft = overrides.microsoft ?? new FakeMicrosoft();
  const graph = overrides.graph ?? new FakeGraph();
  const svc = await OneNoteConnectionSvc.create({
    connection_repo,
    microsoft,
    secret_box,
    createGraph: () => graph
  });

  const { pending } = await svc.startAuthorization();
  const connection = await svc.completeAuthorization({
    user_id: USER_ID,
    session_user_id: USER_ID,
    code: 'code-1',
    state: pending.state,
    pending
  });
  return { svc, connection_repo, microsoft, connection, pending };
}

test('connecting stores the token cache sealed, never in the clear', async () => {
  const { connection_repo, connection } = await connect();

  const row = connection_repo.rows[0];
  assert.equal(row.microsoft_email, 'ada@example.com');
  assert.equal(row.status, OneNoteConnectionStatus.Connected);
  assert.equal(row.token_cache_sealed.includes('a-microsoft-refresh-token'), false);
  assert.equal(secret_box.open(row.token_cache_sealed, { user_id: USER_ID, field: 'onenote_token_cache' }), TOKEN_CACHE);

  assert.equal('token_cache_sealed' in connection, false, 'the sealed cache never reaches the SPA');
  assert.equal('microsoft_home_account_id' in connection, false);
});

test('the code is exchanged with the verifier that was handed out at the start', async () => {
  const { microsoft } = await connect();
  assert.equal(microsoft.exchanged_with?.code_verifier, 'verifier-1');
  assert.equal(microsoft.exchanged_with?.code, 'code-1');
});

test('a callback whose state does not match the cookie is rejected before the exchange', async () => {
  const microsoft = new FakeMicrosoft();
  const svc = await OneNoteConnectionSvc.create({
    connection_repo: new InMemoryConnectionRepo(),
    microsoft,
    secret_box
  });
  const { pending } = await svc.startAuthorization();

  await assert.rejects(
    svc.completeAuthorization({ user_id: USER_ID, session_user_id: USER_ID, code: 'code-1', state: 'forged', pending }),
    UnauthorizedError
  );
  assert.equal(microsoft.exchanged_with, undefined);
});

test('a genuine state cookie planted in another signed-in browser is rejected before the exchange', async () => {
  const microsoft = new FakeMicrosoft();
  const connection_repo = new InMemoryConnectionRepo();
  const svc = await OneNoteConnectionSvc.create({ connection_repo, microsoft, secret_box });

  // The planter started a real flow as themselves; the victim's browser is signed in as someone else.
  const { pending } = await svc.startAuthorization();
  await assert.rejects(
    svc.completeAuthorization({ user_id: 'planter', session_user_id: 'victim', code: 'code-1', state: pending.state, pending }),
    UnauthorizedError
  );

  assert.equal(microsoft.exchanged_with, undefined, "the victim's code is never exchanged");
  assert.equal(connection_repo.rows.length, 0);
});

test('a callback in a browser with no live session is rejected before the exchange', async () => {
  const microsoft = new FakeMicrosoft();
  const svc = await OneNoteConnectionSvc.create({ connection_repo: new InMemoryConnectionRepo(), microsoft, secret_box });
  const { pending } = await svc.startAuthorization();

  await assert.rejects(
    svc.completeAuthorization({ user_id: USER_ID, session_user_id: null, code: 'code-1', state: pending.state, pending }),
    UnauthorizedError
  );
  assert.equal(microsoft.exchanged_with, undefined);
});

test('a sealed cache only opens for the user it was sealed for', async () => {
  const { connection_repo } = await connect();
  const sealed = connection_repo.rows[0].token_cache_sealed;

  assert.throws(
    () => secret_box.open(sealed, { user_id: 'user-2', field: 'onenote_token_cache' }),
    /failed authentication/
  );
});

test('an unchanged cache is not written back, a rotated one is', async () => {
  const unchanged = await connect();
  const sealed_before = unchanged.connection_repo.rows[0].token_cache_sealed;
  assert.equal(await unchanged.svc.getAccessToken(USER_ID), 'access-1');
  assert.equal(unchanged.connection_repo.rows[0].token_cache_sealed, sealed_before, 'no needless write');
  assert.equal(unchanged.microsoft.acquired_with?.token_cache, TOKEN_CACHE, 'MSAL is handed the opened cache');

  const rotated_cache = '{"RefreshToken":{"secret":"rotated"}}';
  const rotating = new FakeMicrosoft(async () => ({ access_token: 'access-2', token_cache: rotated_cache }));
  const { svc, connection_repo } = await connect({ microsoft: rotating });

  assert.equal(await svc.getAccessToken(USER_ID), 'access-2');
  const stored = connection_repo.rows[0].token_cache_sealed;
  assert.notEqual(stored, sealed_before);
  assert.equal(secret_box.open(stored, { user_id: USER_ID, field: 'onenote_token_cache' }), rotated_cache);
});

test('a dead grant parks the connection as needs_reauth instead of retrying forever', async () => {
  const revoked = new FakeMicrosoft(async () => {
    throw new OneNoteReauthRequiredError();
  });
  const { svc, connection_repo } = await connect({ microsoft: revoked });

  await assert.rejects(svc.getAccessToken(USER_ID), OneNoteReauthRequiredError);
  assert.equal(connection_repo.rows[0].status, OneNoteConnectionStatus.NeedsReauth);
  assert.ok(connection_repo.rows[0].last_error);
});

test('connecting a second time replaces the account rather than adding one', async () => {
  const { svc, connection_repo } = await connect();
  const { pending } = await svc.startAuthorization();
  await svc.completeAuthorization({ user_id: USER_ID, session_user_id: USER_ID, code: 'code-2', state: pending.state, pending });

  assert.equal(connection_repo.rows.length, 1);
});

test('nothing is selected on a fresh connection, so nothing syncs by surprise', async () => {
  const { svc, connection_repo } = await connect();

  assert.deepEqual(connection_repo.rows[0].selected_notebook_ids, []);
  const notebooks = await svc.listNotebooks(USER_ID);
  assert.deepEqual(
    notebooks.map((n) => n.selected),
    [false, false]
  );
});

test('choosing notebooks marks them, and re-choosing replaces rather than appends', async () => {
  const { svc, connection_repo } = await connect();

  await svc.selectNotebooks({ user_id: USER_ID, notebook_ids: ['nb-2', 'nb-2'] });
  assert.deepEqual(connection_repo.rows[0].selected_notebook_ids, ['nb-2'], 'duplicates collapse');

  const listed = await svc.listNotebooks(USER_ID);
  assert.deepEqual(listed.find((n) => n.id === 'nb-2')?.selected, true);
  assert.deepEqual(listed.find((n) => n.id === 'nb-1')?.selected, false);

  await svc.selectNotebooks({ user_id: USER_ID, notebook_ids: ['nb-1'] });
  assert.deepEqual(connection_repo.rows[0].selected_notebook_ids, ['nb-1']);
});

test('reconnecting the same account keeps the notebooks already chosen', async () => {
  const { svc, connection_repo } = await connect();
  await svc.selectNotebooks({ user_id: USER_ID, notebook_ids: ['nb-1'] });

  const { pending } = await svc.startAuthorization();
  await svc.completeAuthorization({ user_id: USER_ID, session_user_id: USER_ID, code: 'c', state: pending.state, pending });

  assert.deepEqual(connection_repo.rows[0].selected_notebook_ids, ['nb-1']);
});

test('notebooks cannot be listed or chosen without a connection', async () => {
  const svc = await OneNoteConnectionSvc.create({
    connection_repo: new InMemoryConnectionRepo(),
    microsoft: new FakeMicrosoft(),
    secret_box,
    createGraph: () => new FakeGraph()
  });

  await assert.rejects(svc.listNotebooks(USER_ID), /not connected/);
  await assert.rejects(svc.selectNotebooks({ user_id: USER_ID, notebook_ids: ['nb-1'] }), /not connected/);
});

test('disconnecting removes the connection and reports whether there was one', async () => {
  const { svc, connection_repo } = await connect();

  assert.equal(await svc.disconnect(USER_ID), true);
  assert.equal(connection_repo.rows.length, 0);
  assert.equal(await svc.getConnection(USER_ID), null);
  assert.equal(await svc.disconnect(USER_ID), false);
});

test('OneNote is enabled by the client credentials, which need a redirect URI', () => {
  assert.equal(OneNoteConfigLoader.fromEnv({}), null);
  assert.equal(OneNoteConfigLoader.fromEnv({ MS_OAUTH_CLIENT_ID: '' }), null);
  assert.equal(OneNoteConfigLoader.fromEnv({ MS_OAUTH_REDIRECT_URI: 'http://localhost:3000/cb' }), null);
  assert.throws(() => OneNoteConfigLoader.fromEnv({ MS_OAUTH_CLIENT_ID: 'id' }));
  assert.throws(() => OneNoteConfigLoader.fromEnv({ MS_OAUTH_CLIENT_ID: 'id', MS_OAUTH_CLIENT_SECRET: 'secret' }));

  assert.deepEqual(
    OneNoteConfigLoader.fromEnv({
      MS_OAUTH_CLIENT_ID: 'id',
      MS_OAUTH_CLIENT_SECRET: 'secret',
      MS_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/v1/integrations/onenote/callback'
    }),
    {
      client_id: 'id',
      client_secret: 'secret',
      redirect_uri: 'http://localhost:3000/api/v1/integrations/onenote/callback',
      authority: 'https://login.microsoftonline.com/common'
    }
  );
});

test('the feature stays off unless encryption keys are configured too', () => {
  const oauth_env = {
    MS_OAUTH_CLIENT_ID: 'id',
    MS_OAUTH_CLIENT_SECRET: 'secret',
    MS_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/v1/integrations/onenote/callback'
  };

  assert.equal(OneNoteConnectionSvc.isConfigured(oauth_env), false, 'no keys, nowhere safe to put the grant');
  assert.equal(
    OneNoteConnectionSvc.isConfigured({
      ...oauth_env,
      SECRET_ENCRYPTION_KEYS: `k1:${KEY}`,
      SECRET_ENCRYPTION_ACTIVE_KEY_ID: 'k1'
    }),
    true
  );
});
