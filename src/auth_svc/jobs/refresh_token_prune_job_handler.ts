import type { RefreshTokenRepository } from '../repositories/refresh_token_repository_interface.js';
import { MongooseRefreshTokenRepository } from '../repositories/refresh_token_repository.js';
import {
  AuthJobName,
  RefreshTokenPrunePayloadSchema,
  type RefreshTokenPrunePayload
} from './auth_job.types.js';
import type { JobPayload, RetryPolicy } from '../../jobs_svc/types/job.types.js';
import type { JobContext, JobHandler, JobResult } from '../../jobs_svc/types/job_handler.types.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';
import { logger } from '../../common/logger.js';
import { Time } from '../../lib/time.js';

/**
 * Deletes expired refresh-token sessions. Housekeeping, not user-facing: rows
 * accumulate forever otherwise, and `pruneExpired` had no caller before this.
 *
 * System-wide by design, so the payload carries no user scope.
 */
export class RefreshTokenPruneJobHandler implements JobHandler<RefreshTokenPrunePayload> {
  readonly name = AuthJobName.RefreshTokenPrune;
  readonly lease_ms = Time.minutesToMs(2);
  // Cheap and idempotent, and the next scheduled run would pick up the remainder
  // anyway, so there is little value in grinding at a failure.
  readonly retry_policy: Partial<RetryPolicy> = { max_attempts: 2 };

  private constructor(private readonly repo: RefreshTokenRepository) {}

  static async create(params?: { repo?: RefreshTokenRepository }): Promise<RefreshTokenPruneJobHandler> {
    const repo = params?.repo ?? (await MongooseRefreshTokenRepository.create({ db: DbNameResolver.resolve('auth') }));
    return new RefreshTokenPruneJobHandler(repo);
  }

  parsePayload(raw: JobPayload): RefreshTokenPrunePayload {
    return RefreshTokenPrunePayloadSchema.parse(raw);
  }

  async handle(payload: RefreshTokenPrunePayload, ctx: JobContext): Promise<JobResult> {
    let deleted = 0;

    // Batched so one run cannot hold a long-running delete over the whole
    // collection; stops on an empty batch or on cancellation.
    for (;;) {
      if (ctx.signal.aborted) break;

      const batch = await this.repo.pruneExpired(payload.batch_limit);
      deleted += batch;
      ctx.reportProgress({ processed: deleted, succeeded: deleted, failed: 0 });
      if (batch < payload.batch_limit) break;
    }

    logger.info({ job_id: ctx.job_id, deleted }, 'expired refresh sessions pruned');
    return { outcome: 'succeeded', summary: { deleted } };
  }
}
