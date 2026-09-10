import type {
  EnqueueInput,
  EnqueueResult,
  Job,
  JobName,
  JobStatus
} from './types/job.types.js';

export type ListJobsInput = {
  name?: JobName;
  status?: JobStatus;
  user_id?: string;
  limit?: number;
};

export interface JobsSvcInterface {
  /**
   * Durable enqueue - one Mongo insert, safe to await on a request path.
   * Throws ConflictError when `dedup_key` collides with an active job of the
   * same (name, user_id).
   */
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;

  getJob(job_id: string): Promise<Job | null>;
  listJobs(input: ListJobsInput): Promise<Job[]>;

  /** Cancels a queued job outright; flags a running one for its worker to notice. */
  requestCancel(job_id: string): Promise<Job | null>;

  /**
   * Queue depth by status. A name with queued rows and no registered handler is
   * the signal to watch: those jobs are being claimed and released unrun on a
   * loop, which looks healthy from the outside.
   */
  getStats(params?: { name?: JobName }): Promise<Record<JobStatus, number>>;
}
