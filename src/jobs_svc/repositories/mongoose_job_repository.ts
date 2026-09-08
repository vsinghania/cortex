import type { Connection } from 'mongoose';
import type { Job, JobCheckpoint, JobName, JobProgress, JobSummary } from '../types/job.types.js';
import { JobStatus } from '../types/job.types.js';
import type {
  ClaimParams,
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

const DUPLICATE_KEY_ERROR = 11000;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export class MongooseJobRepository implements JobRepository {
  private static readonly factory = new JobModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: any
  ) {}

  static async create(params?: { db?: string; host?: string; port?: number }): Promise<MongooseJobRepository> {
    const db = params?.db ?? DbNameResolver.resolve('jobs');
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection({ db, host: params?.host, port: params?.port });
    const model = MongooseJobRepository.factory.getModel(conn);
    return new MongooseJobRepository(conn, model);
  }

  async enqueue(params: { job: Job }): Promise<{ job: Job; created: boolean }> {
    const { job } = params;

    if (!job.dedup_key) {
      const created = await this.model.create(job);
      return { job: MongooseUtils.toDomain<Job>(created), created: true };
    }

    // Upsert against uniq_job_dedup_active. A matched (rather than inserted)
    // result means an active job already holds the key.
    //
    // run_at/visible_at live only in $setOnInsert: $setOnInsert and $min on the
    // same path is a conflicting-path error.
    const filter = {
      name: job.name,
      user_id: job.user_id ?? null,
      dedup_key: job.dedup_key,
      dedup_active: true
    };

    try {
      const before = await this.model.findOneAndUpdate(
        filter,
        { $setOnInsert: job },
        { upsert: true, returnDocument: 'before', lean: true }
      );

      if (before) return { job: MongooseUtils.toDomain<Job>(before), created: false };

      const inserted = await this.model.findOne({ id: job.id }).lean();
      return { job: MongooseUtils.toDomain<Job>(inserted), created: true };
    } catch (err) {
      if (!MongooseJobRepository.isDuplicateKeyError(err)) throw err;
      // Lost an upsert race against the unique index; the winner is the active job.
      const existing = await this.model.findOne(filter).lean();
      if (!existing) throw err;
      return { job: MongooseUtils.toDomain<Job>(existing), created: false };
    }
  }

  async claimNext(params: ClaimParams): Promise<Job | null> {
    const { filter, update, options } = JobClaimQuery.build(params);
    const claimed = await this.model.findOneAndUpdate(filter, update, options);
    return claimed ? MongooseUtils.toDomain<Job>(claimed) : null;
  }

  async heartbeat(
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

  async complete(
    params: LeaseKey & {
      result?: JobSummary;
      errors?: Job['errors'];
      progress?: JobProgress;
      retention_sec: number;
    }
  ): Promise<boolean> {
    return this.finalize(params, JobStatus.Succeeded, {
      result: params.result,
      errors: params.errors,
      progress: params.progress
    });
  }

  async fail(
    params: LeaseKey & {
      message: string;
      errors?: Job['errors'];
      progress?: JobProgress;
      retention_sec: number;
    }
  ): Promise<boolean> {
    return this.finalize(params, JobStatus.Failed, {
      last_error: params.message,
      errors: params.errors,
      progress: params.progress
    });
  }

  async cancel(params: LeaseKey & { progress?: JobProgress; retention_sec: number }): Promise<boolean> {
    return this.finalize(params, JobStatus.Cancelled, { progress: params.progress });
  }

  async retryLater(
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

  async release(
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

  async getById(job_id: string): Promise<Job | null> {
    const found = await this.model.findOne({ id: job_id }).lean();
    return found ? MongooseUtils.toDomain<Job>(found) : null;
  }

  async list(params: JobListParams): Promise<Job[]> {
    const filter: Record<string, unknown> = {};
    if (params.name) filter.name = params.name;
    if (params.status) filter.status = params.status;
    if (params.user_id) filter.user_id = params.user_id;

    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, params.limit ?? DEFAULT_LIST_LIMIT));
    const docs = await this.model.find(filter).sort({ created_at: -1 }).limit(limit).lean();
    return docs.map((doc: unknown) => MongooseUtils.toDomain<Job>(doc));
  }

  async requestCancel(params: { job_id: string; now: Date; retention_sec: number }): Promise<Job | null> {
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

    if (cancelled) return MongooseUtils.toDomain<Job>(cancelled);

    // A running job is only flagged; its worker notices on the next heartbeat.
    const flagged = await this.model
      .findOneAndUpdate(
        { id: params.job_id, status: JobStatus.Running },
        { $set: { cancel_requested: true } },
        { returnDocument: 'after', lean: true }
      )
      .exec();

    return flagged ? MongooseUtils.toDomain<Job>(flagged) : null;
  }

  async countByStatus(params?: { name?: JobName }): Promise<Record<JobStatus, number>> {
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
  private async finalize(
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

  private static isDuplicateKeyError(err: unknown): boolean {
    return !!err && typeof err === 'object' && (err as { code?: number }).code === DUPLICATE_KEY_ERROR;
  }
}
