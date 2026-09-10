import { Schema } from 'mongoose';
import type { JobSchedule } from '../types/job_schedule.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

// Encapsulated Mongoose model factory for recurring job definitions.
// Use repositories to obtain instances; do not export Mongoose models directly.
export class JobScheduleModelFactory extends BaseModelFactory<JobSchedule> {

  protected buildSchema(): Schema<JobSchedule> {
    const ScheduleSchema = new Schema(
      {
        kind: { type: String, enum: ['interval', 'cron'], required: true },
        every_ms: { type: Number, default: undefined },   // kind: 'interval'
        expression: { type: String, default: undefined }, // kind: 'cron'
        timezone: { type: String, default: undefined }
      },
      { _id: false, id: false }
    );

    const JobScheduleSchemaMongoose = new Schema<JobSchedule>(
      {
        // Caller-supplied and stable, so re-registering the same schedule at every
        // boot updates one row rather than accumulating duplicates.
        id: { type: String, required: true, unique: true },

        name: { type: String, required: true },
        // Human label for the admin surface; `name` is the discriminator, not a title.
        label: { type: String, default: undefined },
        payload: { type: Schema.Types.Mixed, required: true },

        dedup_key: { type: String, default: undefined },
        user_id: { type: String, default: undefined },

        enabled: { type: Boolean, required: true, default: true },
        schedule: { type: ScheduleSchema, required: true },

        max_attempts: { type: Number, required: true, default: 1 },
        // Absent = no deadline. Becomes deadline_at on each spawned job.
        max_delay_ms: { type: Number, default: undefined },

        next_run_at: { type: Date, required: true },
        last_run_at: { type: Date, default: undefined },
        last_job_id: { type: String, default: undefined },

        created_by: { type: String, default: undefined }
      },
      {
        collection: 'job_schedules',
        versionKey: false,
        // See job_model: an empty payload must survive the round trip.
        minimize: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    // The scheduler tick: enabled schedules whose next firing has arrived.
    JobScheduleSchemaMongoose.index(
      { enabled: 1, next_run_at: 1 },
      { name: 'by_enabled_next_run' }
    );

    JobScheduleSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret;
      }
    });

    return JobScheduleSchemaMongoose;
  }

  protected getModelName(): string {
    return 'JobSchedule';
  }
}
