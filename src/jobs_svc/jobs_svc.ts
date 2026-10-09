import type { EnqueueInput, EnqueueResult, Job, JobName, JobPayload } from './types/job.types.js';
import { JobStatus } from './types/job.types.js';
import type { JobsSvcInterface, ListJobsInput } from './jobs_svc_interface.js';
import type { JobRepository } from './repositories/job_repository_interface.js';
import { MongooseJobRepository } from './repositories/mongoose_job_repository.js';
import { TraceContext } from '../common/trace_context.js';
import { ConflictError } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const CANCELLED_RETENTION_SEC = Time.daysToSec(3);

/**
 * The enqueue side of the queue. Deliberately never imports the worker, so the
 * notes MCP process can hold one and enqueue without hosting a worker - and so a
 * future standalone worker deployment is a compose change rather than a redesign.
 */
export class JobsSvc implements JobsSvcInterface {
  private static instance: JobsSvc | null = null;
  private static in_flight: Promise<JobsSvc> | null = null;

  private constructor(private readonly repo: JobRepository) {}

  static async getInstance(): Promise<JobsSvc> {
    if (JobsSvc.instance) return JobsSvc.instance;
    if (JobsSvc.in_flight) return JobsSvc.in_flight;
    JobsSvc.in_flight = JobsSvc.loadJobsSvcInstance();
    return JobsSvc.in_flight;
  }

  static getExistingInstance(): JobsSvc | null {
    return JobsSvc.instance;
  }

  private static async loadJobsSvcInstance(): Promise<JobsSvc> {
    try {
      const repo = await MongooseJobRepository.create();
      JobsSvc.instance = new JobsSvc(repo);
      return JobsSvc.instance;
    } finally {
      JobsSvc.in_flight = null;
    }
  }

  async enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
    const now = new Date();
    const job = JobsSvc.buildJobRecord(input, now);

    const { job: stored, created, conflict_on } = await this.repo.enqueueJob({ job });

    if (!created) {
      const reason =
        conflict_on === 'scheduled_for'
          ? `This ${input.name} window is already materialized`
          : `A ${input.name} job is already active`;
      throw new ConflictError(reason, {
        details: { job_id: stored.id, conflict_on, status: stored.status }
      });
    }

    logger.info(
      {
        job_id: stored.id,
        job_name: stored.name,
        run_at: stored.run_at,
        max_attempts: stored.max_attempts
      },
      'job enqueued'
    );

    return { job_id: stored.id, created };
  }

  async getJob(job_id: string): Promise<Job | null> {
    return this.repo.getJobById(job_id);
  }

  async listJobs(input: ListJobsInput): Promise<Job[]> {
    return this.repo.listJobs(input);
  }

  async getJobCountsByStatus(params?: { name?: JobName }): Promise<Record<JobStatus, number>> {
    return this.repo.countJobsByStatus(params);
  }

  async requestJobCancellation(job_id: string): Promise<Job | null> {
    const cancelled = await this.repo.requestJobCancellation({
      job_id,
      now: new Date(),
      retention_sec: CANCELLED_RETENTION_SEC
    });

    if (cancelled) {
      logger.info({ job_id, job_name: cancelled.name, status: cancelled.status }, 'job cancel requested');
    }
    return cancelled;
  }

  /**
   * Materializes an EnqueueInput into a Job. The enqueuing request's trace and user
   * are snapshotted here so the worker can stitch its own logs back to the request
   * that queued the work (see JobWorker.runJob).
   */
  private static buildJobRecord(input: EnqueueInput, now: Date): Job {
    const run_at = input.run_at ?? new Date(now.getTime() + (input.delay_ms ?? 0));

    return {
      id: Id.generateUuidV7(),
      name: input.name,
      // Undefined keys are dropped rather than stored: BSON serializes undefined to
      // null, so leaving them in would hand handlers a null where their schema
      // expects an absent field.
      payload: JobsSvc.omitUndefinedPayloadFields(input.payload),
      user_id: input.user_id,

      status: JobStatus.Queued,

      attempts: 0,
      max_attempts: input.max_attempts ?? DEFAULT_MAX_ATTEMPTS,

      run_at,
      visible_at: run_at,
      deadline_at: input.deadline_at,
      scheduled_for: input.scheduled_for,

      locked_by: null,
      locked_at: null,
      lease_expires_at: null,
      reclaimed_count: 0,

      cancel_requested: false,

      dedup_key: input.dedup_key,
      // Set here and unset only at a terminal write, so the lock spans the whole run.
      dedup_active: input.dedup_key ? true : undefined,

      requested_by: input.requested_by,
      schedule_id: input.schedule_id,
      enqueue_trace_id: TraceContext.getTraceId(),
      enqueue_user_id: TraceContext.getUserId(),

      progress: { processed: 0, succeeded: 0, failed: 0 },
      errors: [],

      created_at: now,
      updated_at: now
    };
  }

  private static omitUndefinedPayloadFields(payload: JobPayload): JobPayload {
    return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
  }
}
