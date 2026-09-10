import { Schema } from 'mongoose';
import type { Job } from '../types/job.types.js';
import { JobStatus } from '../types/job.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

// Encapsulated Mongoose model factory for the job queue.
// Use repositories to obtain instances; do not export Mongoose models directly.
export class JobModelFactory extends BaseModelFactory<Job> {

  protected buildSchema(): Schema<Job> {
    const ProgressSchema = new Schema(
      {
        total: { type: Number, default: undefined },
        processed: { type: Number, default: 0 },
        succeeded: { type: Number, default: 0 },
        failed: { type: Number, default: 0 }
      },
      { _id: false, id: false }
    );

    const JobErrorSchema = new Schema(
      {
        item_id: { type: String, default: undefined },
        message: { type: String, required: true },
        occurred_at: { type: Date, required: true }
      },
      { _id: false, id: false }
    );

    const JobSchemaMongoose = new Schema<Job>(
      {
        id: { type: String, required: true, unique: true }, // uuidv7 - time-ordered
        name: { type: String, required: true },

        // Mixed is deliberate: jobs_svc is domain-agnostic and never reads inside a
        // payload. The owning handler validates it with Zod at the top of handle().
        payload: { type: Schema.Types.Mixed, required: true },

        // Optional. Present = this job's work belongs to one user, and the
        // single-flight lock is scoped to them. Absent = system-wide. NOT an auth
        // scope: handlers derive what to read from the payload, never from this.
        user_id: { type: String, default: undefined },

        status: {
          type: String,
          enum: Object.values(JobStatus),
          required: true,
          default: JobStatus.Queued
        },

        attempts: { type: Number, required: true, default: 0 },
        max_attempts: { type: Number, required: true },

        run_at: { type: Date, required: true },
        // run_at while queued, lease_expires_at while running, null when terminal.
        // The only field the claim ranges on.
        visible_at: { type: Date, default: null },

        locked_by: { type: String, default: null },
        locked_at: { type: Date, default: null },
        lease_expires_at: { type: Date, default: null },
        heartbeat_at: { type: Date, default: undefined },
        reclaimed_count: { type: Number, required: true, default: 0 },

        cancel_requested: { type: Boolean, required: true, default: false },

        // Single-flight. dedup_active is set at enqueue and unset only at a terminal
        // write, so the lock spans the whole run rather than just the queued window.
        dedup_key: { type: String, default: undefined },
        dedup_active: { type: Boolean, default: undefined },

        requested_by: { type: String, default: undefined },
        schedule_id: { type: String, default: undefined },
        enqueue_trace_id: { type: String, default: undefined },
        enqueue_user_id: { type: String, default: undefined },

        progress: {
          type: ProgressSchema,
          default: () => ({ processed: 0, succeeded: 0, failed: 0 })
        },
        checkpoint: { type: Schema.Types.Mixed, default: undefined },
        errors: { type: [JobErrorSchema], default: [] },

        result: { type: Schema.Types.Mixed, default: undefined },
        last_error: { type: String, default: undefined },

        started_at: { type: Date, default: undefined },
        finished_at: { type: Date, default: undefined },
        // Set only on a terminal write; anchors the TTL below. Absent on
        // queued/running docs, which Mongo's TTL monitor therefore skips.
        expires_at: { type: Date, default: undefined }
      },
      {
        collection: 'jobs',
        versionKey: false,
        // Mongoose strips empty objects on save by default, and it does so AFTER
        // validation - so `payload: {}` on a required field vanished silently and
        // the handler's schema then rejected `undefined`. The upsert path never
        // saw it, because $setOnInsert bypasses minimize; only create() did.
        minimize: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    // The claim. Two fields, and that is the whole query: equality on status, then
    // visible_at as both sort key and range bound. Sort direction matches the key,
    // so no blocking SORT stage is planned.
    JobSchemaMongoose.index({ status: 1, visible_at: 1 }, { name: 'job_claim' });

    // Single-flight. Equality-only partial filter - the operator subset every
    // MongoDB version accepts ($in/$or are NOT valid in a partialFilterExpression,
    // which is why this keys on a boolean rather than on `status`).
    JobSchemaMongoose.index(
      { name: 1, user_id: 1, dedup_key: 1 },
      {
        unique: true,
        name: 'uniq_job_dedup_active',
        partialFilterExpression: { dedup_active: true }
      }
    );

    // Per-document TTL: expireAfterSeconds 0 means "expire when expires_at passes",
    // so succeeded and failed jobs can carry different retentions from one index.
    JobSchemaMongoose.index({ expires_at: 1 }, { name: 'job_ttl', expireAfterSeconds: 0 });

    // The admin list endpoint: recent jobs of a kind.
    JobSchemaMongoose.index({ name: 1, created_at: -1 }, { name: 'by_name_created' });

    // Run history for one recurring schedule.
    JobSchemaMongoose.index(
      { schedule_id: 1, created_at: -1 },
      { name: 'by_schedule_created', sparse: true }
    );

    JobSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret;
      }
    });

    return JobSchemaMongoose;
  }

  protected getModelName(): string {
    return 'Job';
  }
}
