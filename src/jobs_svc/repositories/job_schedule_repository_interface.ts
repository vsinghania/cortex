import type { JobSchedule } from '../types/job_schedule.types.js';

export interface JobScheduleRepository {
  /** Insert or update by the caller-supplied id, so boot-time registration is idempotent. */
  upsertSchedule(params: { schedule: JobSchedule }): Promise<JobSchedule>;

  /** Enabled schedules whose next firing has arrived. Candidates, not claims. */
  listDueSchedules(params: { now: Date; limit: number }): Promise<JobSchedule[]>;

  /**
   * Compare-and-swap on next_run_at: advances it only if it still holds the value
   * this tick read. Null means another container advanced it first and owns the run.
   *
   * The advance cannot be folded into listDue as one atomic op, because the new
   * next_run_at depends on the schedule's own kind and expression - which is not
   * known until the document has been read. So the read is a candidate and this is
   * the claim.
   *
   * Advancing BEFORE the job is inserted is deliberate: a failed insert then skips
   * a run rather than retrying it forever, which is the safer direction to fail.
   */
  advanceDueSchedule(params: {
    id: string;
    expected_next_run_at: Date;
    next_run_at: Date;
    now: Date;
  }): Promise<JobSchedule | null>;

  /** Records which job the tick spawned. Bookkeeping after the claim, not a lock. */
  recordScheduleRun(params: { id: string; last_job_id: string }): Promise<void>;

  getScheduleById(id: string): Promise<JobSchedule | null>;
  listSchedules(params?: { enabled?: boolean }): Promise<JobSchedule[]>;
  setScheduleEnabled(params: { id: string; enabled: boolean; next_run_at?: Date }): Promise<JobSchedule | null>;
  deleteSchedule(id: string): Promise<boolean>;
}
