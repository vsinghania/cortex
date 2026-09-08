import type {
  Job,
  JobCheckpoint,
  JobName,
  JobProgress,
  JobStatus,
  JobSummary
} from '../types/job.types.js';

export type ClaimParams = { worker_id: string; lease_ms: number; now: Date };

/**
 * The fencing key. Every post-claim write takes it, so a worker that stalled past
 * its lease cannot overwrite the result of whoever reclaimed the job. Without
 * transactions (standalone Mongo) this is the only defence available, and it is
 * sufficient because the lock is one field on one document.
 */
export type LeaseKey = { job_id: string; worker_id: string; now: Date };

export type JobListParams = {
  name?: JobName;
  status?: JobStatus;
  user_id?: string;
  limit?: number;
};

export type HeartbeatResult = Pick<Job, 'id' | 'cancel_requested'>;

export interface JobRepository {
  /**
   * Insert, or refuse when an active job already holds (name, user_id, dedup_key).
   * `created: false` means the key was taken; callers translate that to ConflictError.
   */
  enqueue(params: { job: Job }): Promise<{ job: Job; created: boolean }>;

  /**
   * Atomically dequeues one due job OR reclaims one whose lease expired.
   *
   * The one deliberately un-user-scoped method in this codebase: the worker is a
   * system actor, and user_id comes *out of* the job rather than into the query.
   * Every read method below stays scoped as usual.
   */
  claimNext(params: ClaimParams): Promise<Job | null>;

  /**
   * Extends the lease, flushes progress and checkpoint, and reads the cancel flag
   * in one write. Null means the lease was lost - the caller must abort and write
   * nothing further.
   */
  heartbeat(
    params: LeaseKey & {
      lease_ms: number;
      progress?: JobProgress;
      checkpoint?: JobCheckpoint;
    }
  ): Promise<HeartbeatResult | null>;

  complete(
    params: LeaseKey & { result?: JobSummary; errors?: Job['errors']; progress?: JobProgress; retention_sec: number }
  ): Promise<boolean>;

  retryLater(params: LeaseKey & { run_at: Date; message: string; progress?: JobProgress; checkpoint?: JobCheckpoint }): Promise<boolean>;

  fail(
    params: LeaseKey & { message: string; errors?: Job['errors']; progress?: JobProgress; retention_sec: number }
  ): Promise<boolean>;

  cancel(params: LeaseKey & { progress?: JobProgress; retention_sec: number }): Promise<boolean>;

  /**
   * Hand an unfinished job straight back as queued, flushing what it learned.
   * Burns no attempt - used both by the shutdown drain and when a worker claims a
   * job whose handler it has not registered.
   */
  release(
    params: LeaseKey & { progress?: JobProgress; checkpoint?: JobCheckpoint; delay_ms?: number }
  ): Promise<boolean>;

  getById(job_id: string): Promise<Job | null>;
  list(params: JobListParams): Promise<Job[]>;

  /** Flags a running job; transitions a queued one straight to cancelled. */
  requestCancel(params: { job_id: string; now: Date; retention_sec: number }): Promise<Job | null>;

  countByStatus(params?: { name?: JobName }): Promise<Record<JobStatus, number>>;
}
