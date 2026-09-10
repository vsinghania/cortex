import type { Schedule } from './types/job_schedule.types.js';
import { Cron } from '../lib/cron.js';

export type DueResolution = {
  /** False when a missed window is being skipped rather than fired late. */
  spawn: boolean;
  /** Always computed forward from `now`, never from the stale stored value. */
  next_run_at: Date;
  /** How far behind schedule this tick is, for logging. */
  lateness_ms: number;
};

export class ScheduleClock {
  private constructor() {}

  static nextRunAt(params: { schedule: Schedule; from: Date }): Date {
    const { schedule, from } = params;

    if (schedule.kind === 'interval') {
      return new Date(from.getTime() + schedule.every_ms);
    }
    return Cron.nextRunAt({
      expression: schedule.expression,
      from,
      timezone: schedule.timezone
    });
  }

  /**
   * Decides what a due schedule should do, given how late this tick is.
   *
   * The advance is always forward from `now`, so a container down for six hours
   * fires at most one run rather than six. `catchup` then decides whether even
   * that one fires: true suits cleanup that simply needs to happen, false suits
   * work timed to run off-peak, where a "midnight" sweep starting at 09:00 is
   * worse than a skipped night.
   */
  static resolveDue(params: {
    schedule: Schedule;
    next_run_at: Date;
    now: Date;
    catchup: boolean;
    /** Lateness beyond which a tick counts as a missed window, not a normal one. */
    stale_after_ms: number;
  }): DueResolution {
    const lateness_ms = params.now.getTime() - params.next_run_at.getTime();
    const missed_window = lateness_ms > params.stale_after_ms;

    return {
      spawn: params.catchup || !missed_window,
      next_run_at: ScheduleClock.nextRunAt({ schedule: params.schedule, from: params.now }),
      lateness_ms
    };
  }

  /** Validates a schedule at its config boundary, before it reaches storage. */
  static assertValid(schedule: Schedule): void {
    if (schedule.kind === 'interval') {
      if (!Number.isFinite(schedule.every_ms) || schedule.every_ms <= 0) {
        throw new Error(`Invalid interval schedule: every_ms must be positive, got ${schedule.every_ms}`);
      }
      return;
    }
    Cron.assertValid(schedule.expression);
  }
}
