import { JobHandlerRegistry } from '../jobs_svc/handlers/job_handler_registry.js';
import { NotesReindexJobHandler } from '../notes_svc/jobs/notes_reindex_job_handler.js';
import { NoteVectorizeJobHandler } from '../notes_svc/jobs/note_vectorize_job_handler.js';
import { RefreshTokenPruneJobHandler } from '../auth_svc/jobs/refresh_token_prune_job_handler.js';
import { PasswordResetEmailJobHandler } from '../auth_svc/jobs/password_reset_email_job_handler.js';
import { EmailVerificationEmailJobHandler } from '../auth_svc/jobs/email_verification_email_job_handler.js';
import { OneNoteSyncJobHandler } from '../onenote_svc/jobs/onenote_sync_job_handler.js';
import { OneNoteSyncSweepJobHandler } from '../onenote_svc/jobs/onenote_sync_sweep_job_handler.js';
import { logger } from '../common/logger.js';

/**
 * The one place that knows every job kind. It lives outside jobs_svc because jobs_svc
 * must never import a domain module (scripts/layering.test.ts), so the domains'
 * handlers are handed to it from here.
 *
 * Both composition roots call it: the worker to run jobs, and web-server only as a
 * catalogue, so the admin API and the scheduler can refuse a job name or payload no
 * worker could run.
 */
export class JobHandlerBootstrap {
  private constructor() {}

  /**
   * Throws rather than warning: a handler that silently fails to register means its
   * jobs are claimed and released unrun on a loop, which looks like a healthy worker
   * and an inexplicably stuck queue.
   */
  static async registerAll(): Promise<void> {
    const registry = JobHandlerRegistry.getInstance();
    registry.registerHandler(await NotesReindexJobHandler.create());
    registry.registerHandler(await NoteVectorizeJobHandler.create());
    registry.registerHandler(await RefreshTokenPruneJobHandler.create());
    registry.registerHandler(await PasswordResetEmailJobHandler.create());
    registry.registerHandler(await EmailVerificationEmailJobHandler.create());
    registry.registerHandler(await OneNoteSyncJobHandler.create());
    registry.registerHandler(await OneNoteSyncSweepJobHandler.create());
    logger.info({ job_names: registry.listRegisteredJobNames() }, 'Job handlers registered');
  }
}
