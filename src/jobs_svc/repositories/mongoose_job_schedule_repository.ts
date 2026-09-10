import type { JobSchedule } from '../types/job_schedule.types.js';
import type { JobScheduleRepository } from './job_schedule_repository_interface.js';
import { JobScheduleModelFactory } from '../models/job_schedule_model.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';

const DEFAULT_DUE_LIMIT = 20;

export class MongooseJobScheduleRepository implements JobScheduleRepository {
  private static readonly factory = new JobScheduleModelFactory();

  private constructor(private readonly model: any) {}

  static async create(params?: { db?: string; host?: string; port?: number }): Promise<MongooseJobScheduleRepository> {
    const db = params?.db ?? DbNameResolver.resolve('jobs');
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection({ db, host: params?.host, port: params?.port });
    return new MongooseJobScheduleRepository(MongooseJobScheduleRepository.factory.getModel(conn));
  }

  async upsert(params: { schedule: JobSchedule }): Promise<JobSchedule> {
    const { id, created_at, updated_at, ...rest } = params.schedule;

    const saved = await this.model
      .findOneAndUpdate(
        { id },
        {
          $set: MongooseJobScheduleRepository.mutableFields(rest),
          // Seeded on insert only. next_run_at, so a redeploy does not reset the
          // clock every schedule is counting down to; enabled, so an operator who
          // disabled a schedule through the API is not silently overruled by the
          // next boot. Toggling it afterwards goes through setEnabled.
          $setOnInsert: { id, next_run_at: rest.next_run_at, enabled: rest.enabled }
        },
        { upsert: true, returnDocument: 'after', lean: true }
      )
      .exec();

    return MongooseUtils.toDomain<JobSchedule>(saved);
  }

  async listDue(params: { now: Date; limit: number }): Promise<JobSchedule[]> {
    const docs = await this.model
      .find({ enabled: true, next_run_at: { $lte: params.now } })
      .sort({ next_run_at: 1 })
      .limit(Math.max(1, params.limit || DEFAULT_DUE_LIMIT))
      .lean();
    return docs.map((d: unknown) => MongooseUtils.toDomain<JobSchedule>(d));
  }

  async claimDue(params: {
    id: string;
    expected_next_run_at: Date;
    next_run_at: Date;
    now: Date;
  }): Promise<JobSchedule | null> {
    // next_run_at in the filter is the compare half of the compare-and-swap: a
    // second container that already advanced it no longer matches.
    const claimed = await this.model
      .findOneAndUpdate(
        { id: params.id, enabled: true, next_run_at: params.expected_next_run_at },
        { $set: { next_run_at: params.next_run_at, last_run_at: params.now } },
        { returnDocument: 'after', lean: true }
      )
      .exec();

    return claimed ? MongooseUtils.toDomain<JobSchedule>(claimed) : null;
  }

  async recordRun(params: { id: string; last_job_id: string }): Promise<void> {
    await this.model.updateOne({ id: params.id }, { $set: { last_job_id: params.last_job_id } });
  }

  async getById(id: string): Promise<JobSchedule | null> {
    const found = await this.model.findOne({ id }).lean();
    return found ? MongooseUtils.toDomain<JobSchedule>(found) : null;
  }

  async list(params?: { enabled?: boolean }): Promise<JobSchedule[]> {
    const filter = params?.enabled === undefined ? {} : { enabled: params.enabled };
    const docs = await this.model.find(filter).sort({ next_run_at: 1 }).lean();
    return docs.map((d: unknown) => MongooseUtils.toDomain<JobSchedule>(d));
  }

  async setEnabled(params: { id: string; enabled: boolean; next_run_at?: Date }): Promise<JobSchedule | null> {
    const set: Record<string, unknown> = { enabled: params.enabled };
    // Re-enabling takes a fresh next_run_at, or a schedule disabled for a week
    // would fire the moment it came back.
    if (params.next_run_at) set.next_run_at = params.next_run_at;

    const updated = await this.model
      .findOneAndUpdate({ id: params.id }, { $set: set }, { returnDocument: 'after', lean: true })
      .exec();
    return updated ? MongooseUtils.toDomain<JobSchedule>(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ id });
    return result.deletedCount > 0;
  }

  /** Everything a re-registration may overwrite - see the $setOnInsert above. */
  private static mutableFields(
    rest: Omit<JobSchedule, 'id' | 'created_at' | 'updated_at'>
  ): Record<string, unknown> {
    const { next_run_at, enabled, ...mutable } = rest;
    return mutable;
  }
}
