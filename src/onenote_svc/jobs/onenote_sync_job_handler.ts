import { logger } from '../../common/logger.js';
import { JobsSvc } from '../../jobs_svc/jobs_svc.js';
import type { JobsSvcInterface } from '../../jobs_svc/jobs_svc_interface.js';
import type { JobPayload, RetryPolicy } from '../../jobs_svc/types/job.types.js';
import type { JobContext, JobHandler, JobResult } from '../../jobs_svc/types/job_handler.types.js';
import { Time } from '../../lib/time.js';
import { GraphThrottledError, OneNoteReauthRequiredError } from '../onenote_errors.js';
import { OneNoteSyncSvc } from '../onenote_sync_svc.js';
import { OneNoteJobName, OneNoteSyncPayloadSchema, type OneNoteSyncPayload } from './onenote_job.types.js';
import type { OneNoteSyncCheckpoint } from '../types/onenote_sync.types.js';

/** Well under the lease, so a pass yields long before the worker could reclaim it. */
const BUDGET_MS = Time.minutesToMs(8);
/** Just long enough to let anything else waiting take a turn first. */
const CONTINUATION_DELAY_MS = Time.secondsToMs(2);

/**
 * One user's sync pass. The queue runs at concurrency 1 in one global FIFO, so this
 * deliberately does not run to completion: it works to a wall-clock budget and hands the
 * rest to a follow-up job, which keeps a large first import from sitting in front of
 * every note embed and password-reset email on the box.
 */
export class OneNoteSyncJobHandler implements JobHandler<OneNoteSyncPayload> {
  readonly name = OneNoteJobName.OneNoteSync;
  readonly lease_ms = Time.minutesToMs(12);
  readonly retry_policy: Partial<RetryPolicy> = { max_attempts: 3 };

  private constructor(
    private readonly sync_svc: OneNoteSyncSvc,
    private readonly jobs_svc?: JobsSvcInterface
  ) {}

  static async create(params?: { sync_svc?: OneNoteSyncSvc; jobs_svc?: JobsSvcInterface }): Promise<OneNoteSyncJobHandler> {
    return new OneNoteSyncJobHandler(params?.sync_svc ?? (await OneNoteSyncSvc.create()), params?.jobs_svc);
  }

  parsePayload(raw: JobPayload): OneNoteSyncPayload {
    return OneNoteSyncPayloadSchema.parse(raw);
  }

  async handle(payload: OneNoteSyncPayload, ctx: JobContext): Promise<JobResult> {
    const start_ms = performance.now();
    const resume = OneNoteSyncJobHandler.resolveResumeCheckpoint(payload, ctx);

    try {
      const result = await this.sync_svc.runSyncPass({
        user_id: payload.user_id,
        mode: payload.mode,
        notebook_ids: payload.notebook_ids ?? undefined,
        signal: ctx.signal,
        budget_ms: BUDGET_MS,
        checkpoint: resume,
        // The pass seeds its own counters from the checkpoint, so these are already
        // cumulative. Clamping them to the last reported value instead would freeze the
        // number whenever a reclaimed run legitimately restarts.
        onProgress: (p) => ctx.reportProgress(p),
        // Persisted by the lease heartbeat, so a worker that dies mid-pass is resumed
        // from here rather than re-reading everything it had already done.
        onCheckpoint: (checkpoint) => ctx.setCheckpoint(checkpoint as Record<string, unknown>),
        onError: (entry) => ctx.recordError(entry)
      });

      if (result.completed) {
        return {
          outcome: 'succeeded',
          summary: { ...result.stats, duration_ms: Time.elapsedMs(start_ms) }
        };
      }

      if (result.checkpoint) ctx.setCheckpoint(result.checkpoint as Record<string, unknown>);
      await this.enqueueSyncContinuation(payload, result.checkpoint);
      return {
        outcome: 'succeeded',
        summary: { ...result.stats, partial: true, duration_ms: Time.elapsedMs(start_ms) }
      };
    } catch (err) {
      return OneNoteSyncJobHandler.toSyncJobFailure(err, payload);
    }
  }

  /**
   * The same-job checkpoint wins: it exists only on a retry of this job, which is newer
   * than whatever the payload was created with.
   */
  private static resolveResumeCheckpoint(payload: OneNoteSyncPayload, ctx: JobContext): OneNoteSyncCheckpoint | undefined {
    if (ctx.checkpoint) return ctx.checkpoint as OneNoteSyncCheckpoint;
    if (!payload.resume) return undefined;
    return {
      section_cursor: payload.resume.section_cursor ?? undefined,
      page_next_link: payload.resume.page_next_link ?? undefined,
      watermark_candidate: payload.resume.watermark_candidate ?? undefined,
      pages_seen: payload.resume.pages_seen ?? undefined
    };
  }

  /**
   * Carries no dedup key, unlike the scheduled and manual enqueues: it would collide
   * with the job that is creating it, since that one holds the key until it completes.
   * One continuation per paused pass, so this cannot pile up.
   */
  private async enqueueSyncContinuation(payload: OneNoteSyncPayload, checkpoint?: OneNoteSyncCheckpoint): Promise<void> {
    try {
      const jobs_svc = this.jobs_svc ?? (await JobsSvc.getInstance());
      await jobs_svc.enqueueJob({
        name: OneNoteJobName.OneNoteSync,
        user_id: payload.user_id,
        payload: {
          user_id: payload.user_id,
          mode: payload.mode,
          reason: 'continuation',
          // The scope has to survive, or a continuation would widen to every notebook.
          notebook_ids: payload.notebook_ids ?? null,
          resume: checkpoint ?? null
        },
        delay_ms: CONTINUATION_DELAY_MS
      });
    } catch (err) {
      // Losing the continuation costs time, not correctness: the next scheduled sweep
      // picks the account up again, and every write is an upsert.
      logger.warn({ user_id: payload.user_id, err }, 'onenote sync continuation not enqueued');
    }
  }

  private static toSyncJobFailure(err: unknown, payload: OneNoteSyncPayload): JobResult {
    if (err instanceof OneNoteReauthRequiredError) {
      // The connection is already parked as needs_reauth; only the user can fix it.
      logger.warn({ user_id: payload.user_id, reason: 'reauth_required' }, 'onenote sync stopped');
      return { outcome: 'failed', reason: 'reauth_required', retryable: false };
    }
    if (err instanceof GraphThrottledError) {
      logger.warn({ user_id: payload.user_id, reason: 'throttled' }, 'onenote sync deferred');
      return { outcome: 'failed', reason: 'throttled', retryable: true };
    }
    throw err;
  }
}
