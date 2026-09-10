import type { Schedule } from './types/job_schedule.types.js';
import { Cron } from '../lib/cron.js';

export class ScheduleClock {
  private constructor() {}

  /**
   * The next firing strictly after `from`. Always computed forward from the given
   * instant rather than from a stale stored value, so a container down for six
   * hours materializes one window rather than one per hour missed.
   */
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
   * The instant past which a run is no longer worth starting, or undefined when
   * the schedule sets no limit.
   *
   * Measured from the WINDOW, not from now: "no more than 30 minutes after the
   * 03:00 slot" is the intent, and it must mean the same thing whether the
   * scheduler was punctual or not.
   */
  static deadlineFor(params: { window: Date; max_delay_ms?: number }): Date | undefined {
    if (params.max_delay_ms === undefined) return undefined;
    return new Date(params.window.getTime() + params.max_delay_ms);
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
