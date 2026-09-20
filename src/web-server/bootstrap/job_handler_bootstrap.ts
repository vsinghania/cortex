import { JobHandlerRegistry } from '../../jobs_svc/handlers/job_handler_registry.js';
import { NotesReindexJobHandler } from '../../notes_svc/jobs/notes_reindex_job_handler.js';
import { NoteVectorizeJobHandler } from '../../notes_svc/jobs/note_vectorize_job_handler.js';
import { RefreshTokenPruneJobHandler } from '../../auth_svc/jobs/refresh_token_prune_job_handler.js';
import { PasswordResetEmailJobHandler } from '../../auth_svc/jobs/password_reset_email_job_handler.js';
import { EmailVerificationEmailJobHandler } from '../../auth_svc/jobs/email_verification_email_job_handler.js';
import { OneNoteSyncJobHandler } from '../../onenote_svc/jobs/onenote_sync_job_handler.js';
import { OneNoteSyncSweepJobHandler } from '../../onenote_svc/jobs/onenote_sync_sweep_job_handler.js';
import { logger } from '../../common/logger.js';

/**
 * The one place that knows every job kind this process can run. It lives in the
 * composition root because jobs_svc must never import a domain module
 * (scripts/layering.test.ts), so the domains' handlers are handed to it from here.
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
    registry.register(await NotesReindexJobHandler.create());
    registry.register(await NoteVectorizeJobHandler.create());
    registry.register(await RefreshTokenPruneJobHandler.create());
    registry.register(await PasswordResetEmailJobHandler.create());
    registry.register(await EmailVerificationEmailJobHandler.create());
    registry.register(await OneNoteSyncJobHandler.create());
    registry.register(await OneNoteSyncSweepJobHandler.create());
    logger.info({ job_names: registry.registeredNames() }, 'Job handlers registered');
  }
}
