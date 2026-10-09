import type { Job, JobCheckpoint, JobName, JobProgress, JobSummary } from '../types/job.types.js';
import { JobStatus } from '../types/job.types.js';
import type {
  ClaimParams,
  ConflictField,
  EnqueueOutcome,
  HeartbeatResult,
  JobListParams,
  JobRepository,
  LeaseKey
} from './job_repository_interface.js';
import { JobClaimQuery } from './job_claim_query.js';
import { JobModelFactory } from '../models/job_model.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export class MongooseJobRepository implements JobRepository {
  private static readonly factory = new JobModelFactory();

  private constructor(private readonly model: any) {}

  static async create(params?: { db?: string; host?: string; port?: number }): Promise<MongooseJobRepository> {
    const db = params?.db ?? DbNameResolver.resolve('jobs');
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection({ db, host: params?.host, port: params?.port });
    return new MongooseJobRepository(MongooseJobRepository.factory.getModel(conn));
  }

  /**
   * Insert, letting the unique indexes refuse a duplicate. Two constraints can
   * reject: uniq_schedule_window (this recurrence window already materialized)
   * and uniq_job_dedup_active (a run with this key is still active). Both mean
   * "do not create another", so both return created: false - `conflict_on` says
   * which, because they mean different things to an operator.
   */
  async enqueueJob(params: { job: Job }): Promise<EnqueueOutcome> {
    const { job } = params;

    try {
      const created = await this.model.create(job);
      return { job: MongooseJobRepository.toDomainJob(created), created: true };
    } catch (err) {
      if (!MongooseUtils.isDuplicateKeyError(err)) throw err;

      const conflict_on = MongooseJobRepository.getConflictField(err);
      const existing = await this.findConflictingJob(job, conflict_on);
      return { job: existing ?? job, created: false, conflict_on };
    }
  }

  private async findConflictingJob(job: Job, conflict_on: ConflictField): Promise<Job | null> {
    const filter =
      conflict_on === 'scheduled_for'
        ? { schedule_id: job.schedule_id, scheduled_for: job.scheduled_for }
        : { name: job.name, user_id: job.user_id ?? null, dedup_key: job.dedup_key, dedup_active: true };

    const found = await this.model.findOne(filter).lean();
    return found ? MongooseJobRepository.toDomainJob(found) : null;
  }

  async claimNextJob(params: ClaimParams): Promise<Job | null> {
    const { filter, update, options } = JobClaimQuery.build(params);
    const claimed = await this.model.findOneAndUpdate(filter, update, options);
    return claimed ? MongooseJobRepository.toDomainJob(claimed) : null;
  }

  async renewJobLease(
    params: LeaseKey & { lease_ms: number; progress?: JobProgress; checkpoint?: JobCheckpoint }
  ): Promise<HeartbeatResult | null> {
    const lease_until = new Date(params.now.getTime() + params.lease_ms);

    const set: Record<string, unknown> = {
      lease_expires_at: lease_until,
      visible_at: lease_until,
      heartbeat_at: params.now
    };
    if (params.progress) set.progress = params.progress;
    if (params.checkpoint !== undefined) set.checkpoint = params.checkpoint;

    const updated = await this.model
      .findOneAndUpdate(MongooseJobRepository.buildLeaseFilter(params), { $set: set }, {
        returnDocument: 'after',
        projection: { id: 1, cancel_requested: 1 },
        lean: true
      })
      .exec();

    if (!updated) return null;
    return { id: updated.id, cancel_requested: !!updated.cancel_requested };
  }

  async completeJob(
    params: LeaseKey & {
      result?: JobSummary;
      errors?: Job['errors'];
      progress?: JobProgress;
      retention_sec: number;
    }
  ): Promise<boolean> {
    return this.finalizeJob(params, JobStatus.Succeeded, {
      result: params.result,
      errors: params.errors,
      progress: params.progress
    });
  }

  async failJob(
    params: LeaseKey & {
      message: string;
      errors?: Job['errors'];
      progress?: JobProgress;
      retention_sec: number;
    }
  ): Promise<boolean> {
    return this.finalizeJob(params, JobStatus.Failed, {
      last_error: params.message,
      errors: params.errors,
      progress: params.progress
    });
  }

  async cancelJob(
    params: LeaseKey & { progress?: JobProgress; retention_sec: number; result?: JobSummary }
  ): Promise<boolean> {
    return this.finalizeJob(params, JobStatus.Cancelled, {
      progress: params.progress,
      result: params.result
    });
  }

  async scheduleJobRetry(
    params: LeaseKey & {
      run_at: Date;
      message: string;
      progress?: JobProgress;
      checkpoint?: JobCheckpoint;
    }
  ): Promise<boolean> {
    const set: Record<string, unknown> = {
      status: JobStatus.Queued,
      run_at: params.run_at,
      visible_at: params.run_at,
      last_error: params.message,
      locked_by: null,
      locked_at: null,
      lease_expires_at: null
    };
    if (params.progress) set.progress = params.progress;
    if (params.checkpoint !== undefined) set.checkpoint = params.checkpoint;

    // dedup_active deliberately stays: the single-flight lock holds across retries.
    const updated = await this.model.updateOne(MongooseJobRepository.buildLeaseFilter(params), { $set: set });
    return updated.modifiedCount > 0;
  }

  async releaseJobLease(
    params: LeaseKey & { progress?: JobProgress; checkpoint?: JobCheckpoint; delay_ms?: number }
  ): Promise<boolean> {
    const available_at = new Date(params.now.getTime() + (params.delay_ms ?? 0));

    const set: Record<string, unknown> = {
      status: JobStatus.Queued,
      run_at: available_at,
      visible_at: available_at,
      locked_by: null,
      locked_at: null,
      lease_expires_at: null
    };
    if (params.progress) set.progress = params.progress;
    if (params.checkpoint !== undefined) set.checkpoint = params.checkpoint;

    // No attempt decrement and no attempt burn: a graceful hand-back is not a failure.
    const updated = await this.model.updateOne(MongooseJobRepository.buildLeaseFilter(params), { $set: set });
    return updated.modifiedCount > 0;
  }

  async getJobById(job_id: string): Promise<Job | null> {
    const found = await this.model.findOne({ id: job_id }).lean();
    return found ? MongooseJobRepository.toDomainJob(found) : null;
  }

  async listJobs(params: JobListParams): Promise<Job[]> {
    const filter: Record<string, unknown> = {};
    if (params.name) filter.name = params.name;
    if (params.status) filter.status = params.status;
    if (params.user_id) filter.user_id = params.user_id;

    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, params.limit ?? DEFAULT_LIST_LIMIT));
    const docs = await this.model.find(filter).sort({ created_at: -1 }).limit(limit).lean();
    return docs.map((doc: unknown) => MongooseJobRepository.toDomainJob(doc));
  }

  async requestJobCancellation(params: { job_id: string; now: Date; retention_sec: number }): Promise<Job | null> {
    // A queued job can be cancelled outright - nothing holds it, so skip straight to
    // terminal and release the dedup lock.
    const cancelled = await this.model
      .findOneAndUpdate(
        { id: params.job_id, status: JobStatus.Queued },
        {
          $set: {
            status: JobStatus.Cancelled,
            cancel_requested: true,
            visible_at: null,
            locked_by: null,
            locked_at: null,
            lease_expires_at: null,
            finished_at: params.now,
            expires_at: new Date(params.now.getTime() + params.retention_sec * 1000)
          },
          $unset: { dedup_active: '' }
        },
        { returnDocument: 'after', lean: true }
      )
      .exec();

    if (cancelled) return MongooseJobRepository.toDomainJob(cancelled);

    // A running job is only flagged; its worker notices on the next heartbeat.
    const flagged = await this.model
      .findOneAndUpdate(
        { id: params.job_id, status: JobStatus.Running },
        { $set: { cancel_requested: true } },
        { returnDocument: 'after', lean: true }
      )
      .exec();

    return flagged ? MongooseJobRepository.toDomainJob(flagged) : null;
  }

  async countJobsByStatus(params?: { name?: JobName }): Promise<Record<JobStatus, number>> {
    const match = params?.name ? { name: params.name } : {};
    const rows = await this.model.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const counts = Object.values(JobStatus).reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as Record<JobStatus, number>
    );
    for (const row of rows) {
      if (row._id in counts) counts[row._id as JobStatus] = row.count;
    }
    return counts;
  }

  /**
   * Terminal writes share one shape: set the status, stamp finished_at, arm the TTL
   * via expires_at, drop the lease, and unset dedup_active so the next enqueue of
   * the same key is allowed.
   */
  private async finalizeJob(
    params: LeaseKey & { retention_sec: number },
    status: JobStatus,
    extra: Record<string, unknown>
  ): Promise<boolean> {
    const set: Record<string, unknown> = {
      status,
      visible_at: null,
      locked_by: null,
      locked_at: null,
      lease_expires_at: null,
      finished_at: params.now,
      expires_at: new Date(params.now.getTime() + params.retention_sec * 1000)
    };
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) set[key] = value;
    }

    const updated = await this.model.updateOne(MongooseJobRepository.buildLeaseFilter(params), {
      $set: set,
      $unset: { dedup_active: '' }
    });
    return updated.modifiedCount > 0;
  }

  /** locked_by is the fence: a stalled worker's write matches zero documents. */
  private static buildLeaseFilter(params: LeaseKey): Record<string, unknown> {
    return { id: params.job_id, locked_by: params.worker_id, status: JobStatus.Running };
  }

  private static withoutTimestamps(job: Job): Omit<Job, 'created_at' | 'updated_at'> {
    const { created_at, updated_at, ...rest } = job;
    return rest;
  }

  /**
   * An upsert applies its filter's equality fields to the inserted document, so a
   * system-wide job (no user_id) materializes the field as an explicit null. Both
   * index identically, but `Job.user_id` is `string | undefined`, so drop it back
   * out rather than hand callers a null the type says cannot exist.
   */
  private static toDomainJob(doc: unknown): Job {
    const job = MongooseUtils.toDomain<Job>(doc);
    if (job.user_id === null) delete (job as { user_id?: string | null }).user_id;
    return job;
  }

  /** Mongo reports the offending index's keys, which is how the two are told apart. */
  private static getConflictField(err: unknown): ConflictField {
    const keys = Object.keys((err as { keyPattern?: Record<string, unknown> })?.keyPattern ?? {});
    return keys.includes('scheduled_for') ? 'scheduled_for' : 'dedup_key';
  }
}
