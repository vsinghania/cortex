import type {
  JobCheckpoint,
  JobName,
  JobPayload,
  JobProgress,
  JobSummary,
  RetryPolicy
} from './job.types.js';

/**
 * A handler's only channel for reporting or observing. reportProgress/setCheckpoint
 * are in-memory; the lease timer flushes them to Mongo on its next tick, which is
 * also where cancellation is read.
 */
export type JobContext = {
  readonly job_id: string;
  readonly name: JobName;
  /**
   * Set only when the job is scoped to one user. NOT an authorization scope - derive
   * what to read from the payload, never from this.
   */
  readonly user_id?: string;
  readonly attempt: number;
  readonly max_attempts: number;

  /** Resume cursor from a previous attempt; undefined on the first run. */
  readonly checkpoint?: JobCheckpoint;
  /**
   * Counts persisted by a previous attempt. A resuming handler MUST seed its
   * counters from this, or `processed` jumps backwards after a reclaim.
   */
  readonly progress: JobProgress;

  /** Fires on cancellation or worker shutdown. Long handlers check it between items. */
  readonly signal: AbortSignal;

  reportProgress(progress: Partial<JobProgress>): void;
  recordError(entry: { item_id?: string; message: string }): void;
  setCheckpoint(checkpoint: JobCheckpoint): void;
};

export type JobResult =
  | { outcome: 'succeeded'; summary?: JobSummary }
  | { outcome: 'failed'; reason: string; retryable: boolean };

export interface JobHandler<TPayload = JobPayload> {
  /**
   * Instance field. Note a class's own static `.name` is the class name via
   * Function.prototype.name - always read this off an instance.
   */
  readonly name: JobName;
  readonly retry_policy?: Partial<RetryPolicy>;
  /** Lease length for this kind; a re-index sweep needs more than the default. */
  readonly lease_ms?: number;

  /**
   * Zod boundary. A payload written by a previous deploy can outlive a schema change
   * while sitting in the queue, so storage is an untrusted edge like any other.
   * Throwing here is a PERMANENT failure - a malformed payload never becomes valid.
   */
  parsePayload(raw: JobPayload): TPayload;

  handle(payload: TPayload, ctx: JobContext): Promise<JobResult>;
}
