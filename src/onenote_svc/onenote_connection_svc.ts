import { GraphOneNoteAdapter } from './adapters/graph_onenote_adapter.js';
import type { GraphOneNoteAdapterInterface } from './adapters/graph_onenote_adapter_interface.js';
import { MicrosoftOAuthAdapter } from './adapters/microsoft_oauth_adapter.js';
import type { MicrosoftOAuthAdapterInterface } from './adapters/microsoft_oauth_adapter_interface.js';
import { OneNoteConfigLoader } from './config/onenote_config.js';
import { OneNoteReauthRequiredError } from './onenote_errors.js';
import { MongooseOneNoteConnectionRepository } from './repositories/onenote_connection_repository.js';
import type { OneNoteConnectionRepository } from './repositories/onenote_connection_repository_interface.js';
import {
  OneNoteConnectionStatus,
  type OneNoteAuthorization,
  type OneNoteConnection,
  type OneNoteNotebookChoice,
  type OneNoteOAuthState,
  type PublicOneNoteConnection
} from './types/onenote_connection.types.js';
import { TokenUtils } from '../auth_svc/utils/token_utils.js';
import { NotFoundError, ServiceUnavailableError, UnauthorizedError } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { SecretBox } from '../lib/crypto/secret_box.js';
import { Time } from '../lib/time.js';

/** The AAD field name; changing it would orphan every stored cache. */
const TOKEN_CACHE_FIELD = 'onenote_token_cache';
/** Notebooks are created rarely, so a day-old list is nearly always right. */
const NOTEBOOK_CACHE_TTL_MS = Time.hoursToMs(24);

type OneNoteConnectionSvcDeps = {
  connection_repo: OneNoteConnectionRepository;
  microsoft: MicrosoftOAuthAdapterInterface;
  secret_box: SecretBox;
  /** Built per call, around a token getter, so one user's token never outlives its use. */
  createGraph: (accessToken: () => Promise<string>) => GraphOneNoteAdapterInterface;
};

export type CompleteOneNoteAuthorizationInput = {
  /** Who started the flow, from the sealed state cookie. */
  user_id: string;
  /** Who this browser is signed in as right now, from its own session; null if nobody. */
  session_user_id: string | null;
  code: string;
  state: string;
  pending: OneNoteOAuthState;
};

export class OneNoteConnectionSvc {
  private constructor(private readonly deps: OneNoteConnectionSvcDeps) {}

  /** Both halves are required: without encryption keys there is nowhere safe to put the grant. */
  static isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return OneNoteConfigLoader.fromEnv(env) !== null && SecretBox.isConfigured(env);
  }

  static async create(overrides?: Partial<OneNoteConnectionSvcDeps>): Promise<OneNoteConnectionSvc> {
    return new OneNoteConnectionSvc({
      connection_repo:
        overrides?.connection_repo ??
        (await MongooseOneNoteConnectionRepository.create({ db: DbNameResolver.resolve('onenote') })),
      microsoft: overrides?.microsoft ?? OneNoteConnectionSvc.createAdapter(),
      secret_box: overrides?.secret_box ?? SecretBox.fromEnv(),
      createGraph: overrides?.createGraph ?? ((accessToken) => GraphOneNoteAdapter.create({ accessToken }))
    });
  }

  /** The Graph reader for one user, authorized by that user's stored grant. */
  graphFor(user_id: string): GraphOneNoteAdapterInterface {
    return this.deps.createGraph(() => this.getAccessToken(user_id));
  }

  static toPublic(connection: OneNoteConnection): PublicOneNoteConnection {
    const { token_cache_sealed, microsoft_home_account_id, ...rest } = connection;
    return rest;
  }

  private static createAdapter(): MicrosoftOAuthAdapterInterface {
    const config = OneNoteConfigLoader.fromEnv();
    if (!config) {
      throw new ServiceUnavailableError('OneNote is not configured');
    }
    return MicrosoftOAuthAdapter.create(config);
  }

  async startAuthorization(): Promise<OneNoteAuthorization> {
    const state = TokenUtils.generateOpaqueToken(32);
    const { url, code_verifier } = await this.deps.microsoft.buildAuthorizationUrl({ state });
    return { url, pending: { state, code_verifier } };
  }

  async completeAuthorization(input: CompleteOneNoteAuthorizationInput): Promise<PublicOneNoteConnection> {
    const start_ms = performance.now();

    if (!TokenUtils.constantTimeEquals(input.state, input.pending.state)) {
      logger.warn({ reason: 'state_mismatch' }, 'onenote connect rejected');
      throw new UnauthorizedError('OneNote authorization state mismatch');
    }
    // The state cookie can be genuine and still not be this browser's: someone can start
    // a flow as themselves and plant their cookie here, so that whoever consents next has
    // their OneNote routed into the planter's account. The browser's own session is what
    // says who is actually at the keyboard.
    if (input.session_user_id !== input.user_id) {
      logger.warn(
        { reason: input.session_user_id ? 'session_user_mismatch' : 'no_session', user_id: input.user_id },
        'onenote connect rejected'
      );
      throw new UnauthorizedError('OneNote authorization does not belong to the signed-in user');
    }

    const session = await this.deps.microsoft.exchangeCode({
      code: input.code,
      code_verifier: input.pending.code_verifier
    });

    const connection = await this.deps.connection_repo.upsert({
      user_id: input.user_id,
      identity: session.identity,
      token_cache_sealed: this.seal(session.token_cache, input.user_id),
      scopes: session.scopes
    });

    logger.info(
      { user_id: input.user_id, scope_count: session.scopes.length, duration_ms: Time.elapsedMs(start_ms) },
      'onenote connected'
    );
    return OneNoteConnectionSvc.toPublic(connection);
  }

  async getConnection(user_id: string): Promise<PublicOneNoteConnection | null> {
    const connection = await this.deps.connection_repo.findByUserId(user_id);
    return connection ? OneNoteConnectionSvc.toPublic(connection) : null;
  }

  /**
   * The unredacted row, for callers inside the service boundary that need the watermark
   * and the notebook selection. Never hand this to a controller — use getConnection.
   */
  async getStoredConnection(user_id: string): Promise<OneNoteConnection | null> {
    return this.deps.connection_repo.findByUserId(user_id);
  }

  /** Called only by a sync pass that reached the end; see OneNoteSyncSvc.run. */
  async recordSyncCompleted(params: { user_id: string; sync_watermark?: Date; last_synced_at: Date }): Promise<void> {
    await this.deps.connection_repo.updateSyncState(params);
  }

  /**
   * The only place a stored cache is opened. MSAL decides whether the access token
   * still holds; a rotation is written back, and a dead grant parks the connection
   * so the UI can ask for a reconnect instead of retrying forever.
   */
  async getAccessToken(user_id: string): Promise<string> {
    const connection = await this.deps.connection_repo.findByUserId(user_id);
    if (!connection) {
      throw new NotFoundError('OneNote is not connected');
    }

    try {
      const result = await this.deps.microsoft.acquireAccessToken({
        token_cache: this.open(connection.token_cache_sealed, user_id),
        home_account_id: connection.microsoft_home_account_id
      });

      if (result.token_cache) {
        await this.deps.connection_repo.updateTokenCache({
          user_id,
          token_cache_sealed: this.seal(result.token_cache, user_id)
        });
      }
      return result.access_token;
    } catch (err) {
      if (err instanceof OneNoteReauthRequiredError) {
        await this.deps.connection_repo.updateStatus({
          user_id,
          status: OneNoteConnectionStatus.NeedsReauth,
          last_error: err.message
        });
        logger.warn({ user_id, reason: 'reauth_required' }, 'onenote token refresh failed');
      }
      throw err;
    }
  }

  /**
   * Served from the cached list unless it is stale or a refresh is asked for, so opening
   * settings does not call Microsoft every time. The cost is that a notebook renamed in
   * OneNote keeps its old name here until the cache turns over or the user refreshes.
   */
  async listNotebooks(user_id: string, opts: { refresh?: boolean } = {}): Promise<OneNoteNotebookChoice[]> {
    let connection = await this.requireConnection(user_id);

    if (opts.refresh || OneNoteConnectionSvc.cacheIsStale(connection)) {
      const fetched = await this.graphFor(user_id).listNotebooks();
      connection =
        (await this.deps.connection_repo.cacheNotebooks({
          user_id,
          notebooks: fetched.map((n) => ({ id: n.id, display_name: n.display_name })),
          cached_at: new Date()
        })) ?? connection;
      logger.info({ user_id, notebook_count: fetched.length }, 'onenote notebook list refreshed');
    }

    const selected = new Set(connection.selected_notebook_ids);
    return connection.notebooks.map((n) => ({ ...n, selected: selected.has(n.id) }));
  }

  /**
   * Called when a pass gave up on one notebook. Durable on purpose: the job record it
   * could be derived from is reaped on a TTL, and a notification needs to tell "just
   * started failing" from "has been failing for days".
   */
  async recordNotebookFailed(params: { user_id: string; notebook_id: string; reason: string }): Promise<void> {
    await this.deps.connection_repo.recordNotebookFailure({ ...params, at: new Date() });
  }

  /** Called by a sync pass that finished one notebook; see OneNoteSyncSvc. */
  async recordNotebookSynced(params: {
    user_id: string;
    notebook_id: string;
    sync_watermark?: Date;
    last_synced_at: Date;
  }): Promise<void> {
    await this.deps.connection_repo.updateNotebookSyncState(params);
  }

  private static cacheIsStale(connection: OneNoteConnection): boolean {
    if (!connection.notebooks_cached_at || connection.notebooks.length === 0) return true;
    return Date.now() - connection.notebooks_cached_at.getTime() > NOTEBOOK_CACHE_TTL_MS;
  }

  /**
   * Deselecting stops future syncs; it deliberately leaves already-imported notes in
   * place, because deleting someone's notes on a checkbox would be a poor trade.
   */
  async selectNotebooks(params: { user_id: string; notebook_ids: string[] }): Promise<PublicOneNoteConnection> {
    await this.requireConnection(params.user_id);
    const unique = [...new Set(params.notebook_ids)];
    const updated = await this.deps.connection_repo.updateSelectedNotebooks({
      user_id: params.user_id,
      notebook_ids: unique
    });
    if (!updated) throw new NotFoundError('OneNote is not connected');

    logger.info({ user_id: params.user_id, notebook_count: unique.length }, 'onenote notebooks selected');
    return OneNoteConnectionSvc.toPublic(updated);
  }

  private async requireConnection(user_id: string): Promise<OneNoteConnection> {
    const connection = await this.deps.connection_repo.findByUserId(user_id);
    if (!connection) throw new NotFoundError('OneNote is not connected');
    return connection;
  }

  /** Leaves imported notes alone: they are the user's, and losing them would surprise. */
  async disconnect(user_id: string): Promise<boolean> {
    const deleted = await this.deps.connection_repo.deleteByUserId(user_id);
    if (deleted) {
      logger.info({ user_id }, 'onenote disconnected');
    }
    return deleted;
  }

  private seal(token_cache: string, user_id: string): string {
    return this.deps.secret_box.seal(token_cache, { user_id, field: TOKEN_CACHE_FIELD });
  }

  private open(token_cache_sealed: string, user_id: string): string {
    return this.deps.secret_box.open(token_cache_sealed, { user_id, field: TOKEN_CACHE_FIELD });
  }
}
