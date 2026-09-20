import { Time } from '../../lib/time.js';

/** One sleep, capped: a provider may ask for far longer than a job should hold its lease. */
const MAX_SLEEP_MS = Time.secondsToMs(60);
/** Total time one call may spend waiting before it becomes the job's problem instead. */
const MAX_TOTAL_WAIT_MS = Time.minutesToMs(2);
const MAX_ATTEMPTS = 4;
const DEFAULT_BACKOFF_MS = Time.secondsToMs(2);

export type GraphRetryDecision =
  | { outcome: 'retry'; delay_ms: number }
  /** Retrying could work, but not here - the job's own backoff takes it from here. */
  | { outcome: 'give_up' }
  /** Retrying can never work: the request or the grant is wrong. */
  | { outcome: 'permanent' };

export type GraphRetryInput = {
  status: number;
  retry_after_header?: string | null;
  /** 1 for the first failure. */
  attempt: number;
  /** Total already spent waiting on this call. */
  waited_ms: number;
};

/**
 * Pure, so the throttling rules are unit-tested without a network. Graph throttles the
 * OneNote API readily, and answers 429 with a Retry-After that is worth obeying exactly:
 * backing off faster than asked is how an app gets throttled harder.
 */
export class GraphRetryPolicy {
  private constructor() {}

  static decide(input: GraphRetryInput): GraphRetryDecision {
    if (!GraphRetryPolicy.isRetryableStatus(input.status)) return { outcome: 'permanent' };
    if (input.attempt >= MAX_ATTEMPTS) return { outcome: 'give_up' };

    const asked_ms = GraphRetryPolicy.retryAfterMs(input.retry_after_header);
    const delay_ms = Math.min(asked_ms ?? GraphRetryPolicy.backoffMs(input.attempt), MAX_SLEEP_MS);

    // Better to hand a long wait back to the queue than to hold a worker slot through it.
    if (input.waited_ms + delay_ms > MAX_TOTAL_WAIT_MS) return { outcome: 'give_up' };
    return { outcome: 'retry', delay_ms };
  }

  /** 408 and 429 are the retryable 4xx; everything else in that range is our mistake. */
  private static isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  /** Retry-After is either a count of seconds or an HTTP date. */
  private static retryAfterMs(header?: string | null): number | undefined {
    if (!header) return undefined;

    const seconds = Number(header.trim());
    if (Number.isFinite(seconds) && seconds >= 0) return Time.secondsToMs(seconds);

    const at = Date.parse(header);
    if (Number.isNaN(at)) return undefined;
    return Math.max(0, at - Date.now());
  }

  private static backoffMs(attempt: number): number {
    return DEFAULT_BACKOFF_MS * 2 ** (attempt - 1);
  }
}
