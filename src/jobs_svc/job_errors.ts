import { HttpError } from '../common/errors.js';

const STACK_LIMIT = 2000;
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429]);

/**
 * Marks a failure that will never succeed on retry - a malformed payload, a deleted
 * entity, a permanent rejection from a vendor.
 *
 * Deliberately not a member of common/errors.ts: that hierarchy is HTTP-shaped and
 * exists to be rendered by error_handler.ts, whereas retry semantics have no status
 * code. JobErrorPolicy *reads* the HTTP hierarchy rather than duplicating it.
 */
export class PermanentJobError extends Error {
  readonly error_code: string;

  constructor(message: string, opts?: { error_code?: string; cause?: unknown }) {
    super(message);
    this.name = 'PermanentJobError';
    this.error_code = opts?.error_code ?? 'permanent_job_error';
    if (opts?.cause !== undefined) this.cause = opts.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class JobErrorPolicy {
  private constructor() {}

  /**
   * PermanentJobError            -> permanent
   * HttpError 4xx except 408/429 -> permanent (bad request, not found, forbidden)
   * HttpError 408, 429, 5xx      -> retryable
   * anything else                -> retryable; max_attempts bounds it
   *
   * Fails open on purpose: an unrecognized error is likelier transient than fatal,
   * and the attempt ceiling stops it looping.
   */
  static isRetryable(err: unknown): boolean {
    if (err instanceof PermanentJobError) return false;

    if (HttpError.isHttpError(err)) {
      const status = err.status_code;
      if (status >= 400 && status < 500) return RETRYABLE_CLIENT_STATUSES.has(status);
      return true;
    }

    return true;
  }

  /** Never includes the payload; the stack is truncated. */
  static toMessage(err: unknown): string {
    if (err instanceof Error) return err.message.slice(0, STACK_LIMIT);
    if (typeof err === 'string') return err.slice(0, STACK_LIMIT);
    return 'unknown error';
  }
}
