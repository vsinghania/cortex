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
   * How late a run may start before it is skipped instead. Absent means "no
   * limit" - run it whenever the worker gets to it, which suits cleanup that
   * simply needs to happen.
   *
   * Set it for work whose value is tied to its window: a sweep timed for 03:00 to
   * stay off-peak is worse than useless at 09:00. It becomes `deadline_at` on
   * every spawned job, which the WORKER enforces at the moment work starts - so
   * it covers lateness from any cause, not just a late scheduler.
   */
  max_delay_ms?: number;

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
  max_delay_ms?: number;
  max_attempts?: number;
  created_by?: string;
};
