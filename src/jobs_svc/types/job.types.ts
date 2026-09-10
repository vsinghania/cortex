/**
 * Job kind, and the discriminator that says which handler runs it.
 *
 * Deliberately a plain string rather than an enum: an enum here would have to name
 * domain concepts ('notes_reindex'), and a generic queue module naming a notes
 * concept is what scripts/layering.test.ts forbids. Each domain module exports its
 * own constant (see NotesJobName) and jobs_svc only ever sees an opaque string.
 */
export type JobName = string;

/** jobs_svc never reads inside a payload; the owning handler validates it. */
export type JobPayload = Record<string, unknown>;

export enum JobStatus {
  Queued = 'queued',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled'
}

export type JobProgress = {
  total?: number;
  processed: number;
  succeeded: number;
  failed: number;
};

export type JobErrorEntry = {
  item_id?: string;
  message: string;
  occurred_at: Date;
};

/** Counts, ids and durations only - never handler output that could carry note text. */
export type JobSummary = Record<string, string | number | boolean>;

export type RetryPolicy = {
  max_attempts: number;
  base_delay_ms: number;
  max_delay_ms: number;
  jitter: 'full' | 'none';
};

export type JobCheckpoint = Record<string, unknown>;

export interface Job {
  id: string;
  name: JobName;
  payload: JobPayload;

  /**
   * Optional. Present means this job's work belongs to one user, which scopes the
   * single-flight lock; absent means system-wide. NOT an authorization scope - a
   * handler decides what to read from its payload, never from this.
   */
  user_id?: string;

  status: JobStatus;

  attempts: number;
  max_attempts: number;

  run_at: Date;
  /**
   * run_at while queued, lease_expires_at while running, null when terminal. The
   * only field the claim ranges on, which is what keeps that query two predicates.
   */
  visible_at: Date | null;

  /**
   * Not after this. The upper half of the job's timing contract, checked once the
   * job is claimed - `run_at` says "not before", this says "not after".
   *
   * It exists because lateness is a question about the moment work *starts*, and
   * only the worker is present for that. Anything deciding it earlier - a
   * scheduler at enqueue time - can only guess, and is blind to lateness caused
   * by backlog or a stalled worker.
   */
  deadline_at?: Date;

  /**
   * Which recurrence window this job is, frozen at materialization. Paired with
   * `schedule_id` it identifies a run uniquely, which is what makes materializing
   * a window idempotent - see uniq_schedule_window. Absent on ad-hoc jobs.
   */
  scheduled_for?: Date;

  locked_by: string | null;
  locked_at: Date | null;
  lease_expires_at: Date | null;
  heartbeat_at?: Date;
  reclaimed_count: number;

  cancel_requested: boolean;

  dedup_key?: string;
  /** Gates uniq_job_dedup_active. Set at enqueue, unset only at a terminal write. */
  dedup_active?: boolean;

  /** Who triggered the run, for audit. Not a tenant scope. */
  requested_by?: string;
  schedule_id?: string;
  enqueue_trace_id?: string;
  enqueue_user_id?: string;

  progress: JobProgress;
  /** Resume cursor written by a previous attempt; undefined on the first run. */
  checkpoint?: JobCheckpoint;
  errors: JobErrorEntry[];

  result?: JobSummary;
  last_error?: string;

  started_at?: Date;
  finished_at?: Date;
  /** Per-document TTL anchor; set only at a terminal write. */
  expires_at?: Date;

  created_at: Date;
  updated_at: Date;
}

export type EnqueueInput = {
  name: JobName;
  payload: JobPayload;
  /** Set when the work belongs to exactly one user; scopes the dedup key. */
  user_id?: string;
  /** Single-flight key, scoped by (name, user_id). Omit for fire-and-forget. */
  dedup_key?: string;
  requested_by?: string;
  schedule_id?: string;
  delay_ms?: number;
  run_at?: Date;
  /** Not after this; the worker cancels rather than starting a job past it. */
  deadline_at?: Date;
  /** The recurrence window this run represents. Scheduler-only. */
  scheduled_for?: Date;
  max_attempts?: number;
};

export type EnqueueResult = {
  job_id: string;
  /** False when an active job already held (name, user_id, dedup_key). */
  created: boolean;
};
