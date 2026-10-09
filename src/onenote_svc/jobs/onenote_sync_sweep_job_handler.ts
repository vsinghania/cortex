import { ConflictError } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';
import { JobsSvc } from '../../jobs_svc/jobs_svc.js';
import type { JobsSvcInterface } from '../../jobs_svc/jobs_svc_interface.js';
import type { JobPayload } from '../../jobs_svc/types/job.types.js';
import type { JobContext, JobHandler, JobResult } from '../../jobs_svc/types/job_handler.types.js';
import { Time } from '../../lib/time.js';
import { MongooseOneNoteConnectionRepository } from '../repositories/onenote_connection_repository.js';
import type { OneNoteConnectionRepository } from '../repositories/onenote_connection_repository_interface.js';
import {
  OneNoteJobKeys,
  OneNoteJobName,
  OneNoteSyncSweepPayloadSchema,
  type OneNoteSyncSweepPayload
} from './onenote_job.types.js';

const MAX_CONNECTIONS_PER_SWEEP = 500;

/**
 * The recurring trigger: one system-wide schedule fans out to a sync per connected
 * account. Per-connection schedules were the alternative and would mean a create on
 * connect, a delete on disconnect, and rows nobody owns when either is missed.
 *
 * Carries no user_id of its own - it is not scoped to anyone, and reads the accounts
 * to enqueue from the repository rather than from its payload.
 */
export class OneNoteSyncSweepJobHandler implements JobHandler<OneNoteSyncSweepPayload> {
  readonly name = OneNoteJobName.OneNoteSyncSweep;
  readonly lease_ms = Time.minutesToMs(2);

  private constructor(
    private readonly connection_repo: OneNoteConnectionRepository,
    private readonly jobs_svc?: JobsSvcInterface
  ) {}

  static async create(params?: {
    connection_repo?: OneNoteConnectionRepository;
    jobs_svc?: JobsSvcInterface;
  }): Promise<OneNoteSyncSweepJobHandler> {
    const connection_repo =
      params?.connection_repo ??
      (await MongooseOneNoteConnectionRepository.create({ db: DbNameResolver.resolve('onenote') }));
    return new OneNoteSyncSweepJobHandler(connection_repo, params?.jobs_svc);
  }

  parsePayload(raw: JobPayload): OneNoteSyncSweepPayload {
    return OneNoteSyncSweepPayloadSchema.parse(raw);
  }

  async handle(_payload: OneNoteSyncSweepPayload, ctx: JobContext): Promise<JobResult> {
    const start_ms = performance.now();
    const connections = await this.connection_repo.listSyncableConnections({ limit: MAX_CONNECTIONS_PER_SWEEP });
    const jobs_svc = this.jobs_svc ?? (await JobsSvc.getInstance());

    let enqueued = 0;
    let already_running = 0;

    for (const connection of connections) {
      if (ctx.signal.aborted) break;
      try {
        await jobs_svc.enqueueJob({
          name: OneNoteJobName.OneNoteSync,
          user_id: connection.user_id,
          payload: { user_id: connection.user_id, mode: 'incremental', reason: 'scheduled' },
          dedup_key: OneNoteJobKeys.syncDedupKey(connection.user_id)
        });
        enqueued += 1;
      } catch (err) {
        // The dedup key rejecting is the overrun guard doing its job: this account's
        // previous sync has not finished, so skipping the window is the correct outcome.
        if (!(err instanceof ConflictError)) throw err;
        already_running += 1;
      }
      ctx.reportProgress({ processed: enqueued + already_running });
    }

    logger.info(
      { candidates: connections.length, enqueued, already_running, duration_ms: Time.elapsedMs(start_ms) },
      'onenote sync sweep completed'
    );
    return { outcome: 'succeeded', summary: { candidates: connections.length, enqueued, already_running } };
  }
}
