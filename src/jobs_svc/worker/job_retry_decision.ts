import type { RetryPolicy } from '../types/job.types.js';
import { JobErrorPolicy } from '../job_errors.js';
import { JobBackoff } from './job_backoff.js';

export type RetryDecision =
  | { outcome: 'retry'; run_at: Date; delay_ms: number }
  | { outcome: 'fail'; reason: 'permanent_error' | 'attempts_exhausted' };

export class JobRetryDecision {
  private constructor() {}

  /**
   * The single place attempts, max_attempts and retryability combine.
   *
   * `attempts` is the count *including* the attempt that just failed, because the
   * claim increments before the handler runs (see MongooseJobRepository.claimNextJob).
   * So attempts === max_attempts means the budget is spent.
   *
   * `explicit_retryable` comes from a handler returning { outcome: 'failed' } and
   * overrides classification - the handler knows more than the error type does.
   */
  static decideJobRetry(params: {
    attempts: number;
    max_attempts: number;
    err?: unknown;
    explicit_retryable?: boolean;
    policy: RetryPolicy;
    now: Date;
    random?: () => number;
  }): RetryDecision {
    const retryable = params.explicit_retryable ?? JobErrorPolicy.isRetryable(params.err);
    if (!retryable) return { outcome: 'fail', reason: 'permanent_error' };

    if (params.attempts >= params.max_attempts) {
      return { outcome: 'fail', reason: 'attempts_exhausted' };
    }

    const delay_ms = JobBackoff.nextDelayMs({
      attempt: params.attempts,
      policy: params.policy,
      random: params.random
    });

    return {
      outcome: 'retry',
      run_at: new Date(params.now.getTime() + delay_ms),
      delay_ms
    };
  }
}
