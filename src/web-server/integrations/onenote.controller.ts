import express from 'express';
import { z } from 'zod';
import { AppLinks } from '../../auth_svc/app_links.js';
import { AuthSvc } from '../../auth_svc/auth_svc.js';
import { REFRESH_COOKIE_NAME } from '../../auth_svc/utils/token_utils.js';
import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from '../../common/errors.js';
import { JobsSvc } from '../../jobs_svc/jobs_svc.js';
import { JobStatus } from '../../jobs_svc/types/job.types.js';
import { OneNoteJobKeys, OneNoteJobName } from '../../onenote_svc/jobs/onenote_job.types.js';
import { logger } from '../../common/logger.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { SecretBox } from '../../lib/crypto/secret_box.js';
import { Time } from '../../lib/time.js';
import { OneNoteConnectionSvc } from '../../onenote_svc/onenote_connection_svc.js';
import { OneNoteSyncSvc } from '../../onenote_svc/onenote_sync_svc.js';
import { CookieOptions } from '../cookie_options.js';

const STATE_COOKIE_NAME = 'ms_oauth';
const STATE_COOKIE_PATH = '/api/v1/integrations/onenote';
const STATE_TTL_MS = Time.minutesToMs(10);
const STATE_FIELD = 'onenote_oauth_state';
/** There is no per-user binding to seal against yet; the field name is the whole scope. */
const STATE_SCOPE = 'pending';
/** Newest first, so a handful is enough to find the latest run. */
const SYNC_LOOKBACK = 5;

/**
 * The callback is a plain browser navigation, so it carries no bearer token and this
 * cookie is what records who started the flow. Sealed rather than JSON because anyone
 * can edit their own cookies: unsealed, a user could put someone else's user_id in it
 * and sync their own OneNote into that account. Sealing does not stop a *genuine*
 * cookie being planted in another browser - the session check at the callback does.
 */
const PendingStateSchema = z.object({
  state: z.string().min(1),
  code_verifier: z.string().min(1),
  user_id: z.string().min(1)
});

type PendingState = z.infer<typeof PendingStateSchema>;

/** Bounded so a malformed client cannot ask the sync to walk an unbounded list. */
const SelectNotebooksSchema = z
  .object({ notebook_ids: z.array(z.string().min(1).max(512)).max(100) })
  .strict();

/** `full` ignores the watermark and re-reads everything; the default is the cheap pass. */
const StartSyncSchema = z
  .object({
    mode: z.enum(['incremental', 'full']).optional(),
    /** Narrows the pass; safe because each notebook carries its own watermark. */
    notebook_ids: z.array(z.string().min(1).max(512)).max(100).optional()
  })
  .strict();

export class OneNoteController {
  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    this.router.post('/start', RequireAuthMiddleware.requireAuth, this.startAuthorization.bind(this));
    this.router.get('/callback', this.completeAuthorization.bind(this));
    this.router.get('/status', RequireAuthMiddleware.requireAuth, this.getConnectionStatus.bind(this));
    this.router.get('/notebooks', RequireAuthMiddleware.requireAuth, this.listNotebooks.bind(this));
    this.router.put('/notebooks', RequireAuthMiddleware.requireAuth, this.selectNotebooks.bind(this));
    this.router.post('/sync', RequireAuthMiddleware.requireAuth, this.startSync.bind(this));
    this.router.get('/sync/:job_id', RequireAuthMiddleware.requireAuth, this.getSyncJobStatus.bind(this));
    this.router.post('/notes/:note_id/sync', RequireAuthMiddleware.requireAuth, this.syncNote.bind(this));
    this.router.delete('/', RequireAuthMiddleware.requireAuth, this.disconnect.bind(this));
  }

  private static buildStateCookieOptions() {
    return CookieOptions.oauthState({ path: STATE_COOKIE_PATH, max_age_ms: STATE_TTL_MS });
  }

  private static readPendingState(req: express.Request): PendingState | null {
    const sealed = (req as any).cookies?.[STATE_COOKIE_NAME] as string | undefined;
    if (!sealed) return null;

    try {
      const opened = SecretBox.fromEnv().open(sealed, { user_id: STATE_SCOPE, field: STATE_FIELD });
      const parsed = PendingStateSchema.safeParse(JSON.parse(opened));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Answers with the URL rather than redirecting: the SPA calls this with its bearer
   * token and then navigates itself, which is how the callback can know the user.
   */
  private async startAuthorization(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const user_id = req.auth!.user_id;
      // Missing encryption keys would otherwise surface as an opaque 500 from SecretBox.
      if (!OneNoteConnectionSvc.isConfigured()) {
        throw new ServiceUnavailableError('OneNote is not configured');
      }

      const onenote_svc = await OneNoteConnectionSvc.create();
      const { url, pending } = await onenote_svc.startAuthorization();

      const sealed = SecretBox.fromEnv().seal(JSON.stringify({ ...pending, user_id }), {
        user_id: STATE_SCOPE,
        field: STATE_FIELD
      });
      res.cookie(STATE_COOKIE_NAME, sealed, OneNoteController.buildStateCookieOptions());

      res.status(200).json({ response: { url } });
    } catch (e) {
      next(e);
    }
  }

  // A browser navigation, so failures redirect back to the SPA rather than answering
  // with a problem document nobody would see.
  private async completeAuthorization(req: express.Request, res: express.Response) {
    const links = AppLinks.fromEnv();
    const pending = OneNoteController.readPendingState(req);
    res.clearCookie(STATE_COOKIE_NAME, OneNoteController.buildStateCookieOptions());

    const { code, state, error } = req.query;
    if (typeof error === 'string') {
      logger.info({ reason: error }, 'onenote connect abandoned');
      res.redirect(links.buildSettingsUrl({ error: error === 'access_denied' ? 'onenote_cancelled' : 'onenote_failed' }));
      return;
    }
    if (!pending || typeof code !== 'string' || typeof state !== 'string') {
      logger.warn({ reason: pending ? 'missing_code' : 'missing_state_cookie' }, 'onenote connect rejected');
      res.redirect(links.buildSettingsUrl({ error: 'onenote_failed' }));
      return;
    }

    try {
      // The refresh cookie is SameSite=lax, so it rides along on this top-level
      // navigation back from Microsoft and says who this browser is signed in as.
      const refresh_token = (req as any).cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      const session_user_id = await (await AuthSvc.create()).findSessionUserId(refresh_token);

      const onenote_svc = await OneNoteConnectionSvc.create();
      await onenote_svc.completeAuthorization({ user_id: pending.user_id, session_user_id, code, state, pending });
      res.redirect(links.buildSettingsUrl({ connected: 'onenote' }));
    } catch (err) {
      logger.error({ err }, 'onenote connect failed');
      res.redirect(links.buildSettingsUrl({ error: 'onenote_failed' }));
    }
  }

  private async getConnectionStatus(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const available = OneNoteConnectionSvc.isConfigured();
      if (!available) {
        res.status(200).json({ response: { available, connection: null } });
        return;
      }

      const onenote_svc = await OneNoteConnectionSvc.create();
      const connection = await onenote_svc.getConnection(req.auth!.user_id);
      res.status(200).json({
        response: { available, connection, last_sync: await OneNoteController.getLastSyncJob(req.auth!.user_id) }
      });
    } catch (e) {
      next(e);
    }
  }

  private async listNotebooks(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const onenote_svc = await OneNoteConnectionSvc.create();
      // ?refresh=1 is the "Refresh list" button asking to go past the cache.
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const notebooks = await onenote_svc.listNotebooks(req.auth!.user_id, { refresh });
      res.status(200).json({ response: { notebooks } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: SelectNotebooksSchema })
  private async selectNotebooks(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { notebook_ids } = req.body as { notebook_ids: string[] };
      const onenote_svc = await OneNoteConnectionSvc.create();
      const connection = await onenote_svc.selectNotebooks({ user_id: req.auth!.user_id, notebook_ids });
      res.status(200).json({ response: { connection } });
    } catch (e) {
      next(e);
    }
  }

  /**
   * 202 with the job to poll. A sync already running is not an error: the dedup key
   * rejects the second enqueue and the caller is pointed at the run in flight.
   */
  @validateRequest({ body: StartSyncSchema })
  private async startSync(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const user_id = req.auth!.user_id;
      const body = (req.body ?? {}) as { mode?: 'incremental' | 'full'; notebook_ids?: string[] };
      const mode = body.mode ?? 'incremental';

      const onenote_svc = await OneNoteConnectionSvc.create();
      const connection = await onenote_svc.getConnection(user_id);
      if (!connection) throw new NotFoundError('OneNote is not connected');
      if (connection.selected_notebook_ids.length === 0) {
        throw new BadRequestError('Choose at least one notebook to sync');
      }

      const jobs_svc = await JobsSvc.getInstance();
      try {
        const job = await jobs_svc.enqueueJob({
          name: OneNoteJobName.OneNoteSync,
          user_id,
          payload: { user_id, mode, reason: 'manual', notebook_ids: body.notebook_ids ?? null },
          dedup_key: OneNoteJobKeys.syncDedupKey(user_id),
          requested_by: user_id
        });
        res.status(202).json({ response: { job_id: job.job_id, already_running: false } });
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
        // The dedup key rejected it, and names the run already in flight to poll instead.
        const running_job_id = (err.details as { job_id?: string } | undefined)?.job_id ?? null;
        res.status(202).json({ response: { job_id: running_job_id, already_running: true } });
      }
    } catch (e) {
      next(e);
    }
  }

  /** Scoped to the caller: the admin job routes are not reusable for a user-facing poll. */
  private async getSyncJobStatus(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const jobs_svc = await JobsSvc.getInstance();
      const job_id = String(req.params.job_id ?? '');
      const job = await jobs_svc.getJob(job_id);
      if (!job || job.user_id !== req.auth!.user_id || job.name !== OneNoteJobName.OneNoteSync) {
        throw new NotFoundError('Sync job not found');
      }

      res.status(200).json({
        response: {
          job: {
            id: job.id,
            status: job.status,
            progress: job.progress,
            result: job.result ?? null,
            last_error: job.last_error ?? null,
            finished_at: job.finished_at ?? null,
            current_notebook_id:
              (job.checkpoint as { current_notebook_id?: string } | undefined)?.current_notebook_id ?? null
          }
        }
      });
    } catch (e) {
      next(e);
    }
  }

  /**
   * The most recent sync, whatever became of it. Reporting only running jobs meant a
   * failure vanished on reload: the error lived in the tab that saw it, and the card
   * went back to looking idle with no explanation for stale notebooks.
   */
  private static async getLastSyncJob(user_id: string) {
    const jobs_svc = await JobsSvc.getInstance();
    const recent = await jobs_svc.listJobs({ name: OneNoteJobName.OneNoteSync, user_id, limit: SYNC_LOOKBACK });
    // Prefer one still going; otherwise the newest finished, which `list` sorts first.
    const job =
      recent.find((candidate) => candidate.status === JobStatus.Queued || candidate.status === JobStatus.Running) ??
      recent[0];
    if (!job) return null;

    return {
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      result: job.result ?? null,
      last_error: job.last_error ?? null,
      finished_at: job.finished_at ?? null,
      notebook_ids: (job.payload as { notebook_ids?: string[] | null })?.notebook_ids ?? null,
      current_notebook_id: (job.checkpoint as { current_notebook_id?: string } | undefined)?.current_notebook_id ?? null
    };
  }

  /**
   * One page, inline. A Graph read plus an upsert is about a second, so making this a
   * job would cost more in waiting for the queue than in doing the work.
   */
  private async syncNote(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const sync_svc = await OneNoteSyncSvc.create();
      const note = await sync_svc.syncNote({
        user_id: req.auth!.user_id,
        note_id: String(req.params.note_id ?? '')
      });
      res.status(200).json({ response: { note } });
    } catch (e) {
      next(e);
    }
  }

  private async disconnect(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const onenote_svc = await OneNoteConnectionSvc.create();
      const disconnected = await onenote_svc.disconnect(req.auth!.user_id);
      res.status(200).json({ response: { disconnected } });
    } catch (e) {
      next(e);
    }
  }
}
