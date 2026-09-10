import type { JobName, JobPayload } from './job.types.js';

export type ScheduleKind = 'interval' | 'cron';

/** Discriminated on `kind`, matching the house idiom for unions. */
export type Schedule =
  | { kind: 'interval'; every_ms: number }
  | { kind: 'cron'; expression: string; timezone?: string };

export interface JobSchedule {
  id: string;
  /** The job name to spawn. */
  name: JobName;
  /** Human label for the admin surface - `name` is the discriminator, not a title. */
  label?: string;
  payload: JobPayload;

  /** Copied onto every spawned run, so overrun is refused by uniq_job_dedup_active. */
  dedup_key?: string;
  user_id?: string;

  enabled: boolean;
  schedule: Schedule;

  max_attempts: number;

  /**
   * When a container boots to find this stale, `catchup` decides whether the
   * missed window fires once immediately or is skipped to the next occurrence.
   * True suits cleanup; false suits anything timed to run off-peak, where firing
   * a "midnight" sweep at 09:00 is worse than skipping it.
   */
  catchup: boolean;

  next_run_at: Date;
  last_run_at?: Date;
  last_job_id?: string;

  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export type UpsertScheduleInput = {
  /** Stable id, so re-registering the same schedule at boot updates rather than duplicates. */
  id: string;
  name: JobName;
  payload: JobPayload;
  schedule: Schedule;
  label?: string;
  dedup_key?: string;
  user_id?: string;
  enabled?: boolean;
  catchup?: boolean;
  max_attempts?: number;
  created_by?: string;
};
