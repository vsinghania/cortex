import type { Job, JobCheckpoint, JobErrorEntry, JobName, JobProgress } from '../types/job.types.js';
import type { JobContext } from '../types/job_handler.types.js';

const MAX_RECORDED_ERRORS = 50;

export type AbortReason = 'cancelled' | 'lease_lost' | 'shutdown';

/**
 * The live state of one job execution. reportProgress/setCheckpoint are in-memory
 * and cheap enough to call per item; the worker's lease timer flushes the latest
 * snapshot to Mongo, which is also where cancellation is read.
 */
export class JobRunContext implements JobContext {
  readonly job_id: string;
  readonly name: JobName;
  readonly user_id?: string;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly checkpoint?: JobCheckpoint;
  readonly progress: JobProgress;

  private readonly controller = new AbortController();
  private current_progress: JobProgress;
  private current_checkpoint?: JobCheckpoint;
  private recorded_errors: JobErrorEntry[];
  private abort_reason: AbortReason | null = null;

  private constructor(job: Job) {
    this.job_id = job.id;
    this.name = job.name;
    this.user_id = job.user_id;
    this.attempt = job.attempts;
    this.max_attempts = job.max_attempts;

    // Seeded from what a previous attempt persisted, so a resumed sweep continues
    // its counters instead of restarting them at zero.
    this.checkpoint = job.checkpoint;
    this.progress = { ...job.progress };
    this.current_progress = { ...job.progress };
    this.current_checkpoint = job.checkpoint;
    this.recorded_errors = [...(job.errors ?? [])];
  }

  static forJob(job: Job): JobRunContext {
    return new JobRunContext(job);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  reportProgress(progress: Partial<JobProgress>): void {
    this.current_progress = { ...this.current_progress, ...progress };
  }

  recordError(entry: { item_id?: string; message: string }): void {
    if (this.recorded_errors.length >= MAX_RECORDED_ERRORS) return;
    this.recorded_errors.push({ ...entry, occurred_at: new Date() });
  }

  setCheckpoint(checkpoint: JobCheckpoint): void {
    this.current_checkpoint = checkpoint;
  }

  abort(reason: AbortReason): void {
    if (this.abort_reason) return;
    this.abort_reason = reason;
    this.controller.abort();
  }

  getAbortReason(): AbortReason | null {
    return this.abort_reason;
  }

  snapshotProgress(): JobProgress {
    return { ...this.current_progress };
  }

  snapshotCheckpoint(): JobCheckpoint | undefined {
    return this.current_checkpoint;
  }

  snapshotErrors(): JobErrorEntry[] {
    return [...this.recorded_errors];
  }
}
