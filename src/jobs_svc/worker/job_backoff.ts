import type { RetryPolicy } from '../types/job.types.js';

const MAX_EXPONENT = 30;

export class JobBackoff {
  private constructor() {}

  /**
   * Exponential with optional full jitter, capped at max_delay_ms.
   * `random` is injected so tests are deterministic.
   *
   * Full jitter (a uniform draw over [0, capped]) rather than the capped value
   * itself: N workers whose jobs failed together would otherwise all retry on the
   * same tick, reproducing the pile-up that caused the failure.
   */
  static nextDelayMs(params: {
    attempt: number;
    policy: RetryPolicy;
    random?: () => number;
  }): number {
    const { policy } = params;
    const attempt = Math.max(1, params.attempt);
    const exponent = Math.min(attempt - 1, MAX_EXPONENT);

    const uncapped = policy.base_delay_ms * Math.pow(2, exponent);
    const capped = Math.min(uncapped, policy.max_delay_ms);

    if (policy.jitter === 'none') return Math.round(capped);

    const random = params.random ?? Math.random;
    return Math.round(capped * random());
  }

  static nextRunAt(params: {
    attempt: number;
    policy: RetryPolicy;
    now: Date;
    random?: () => number;
  }): Date {
    return new Date(params.now.getTime() + JobBackoff.nextDelayMs(params));
  }
}
