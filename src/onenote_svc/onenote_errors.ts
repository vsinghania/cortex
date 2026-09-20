/**
 * The grant is gone - revoked by the user, expired, or consented for a different
 * account. Distinct from a transient failure because no amount of retrying fixes
 * it: the connection is parked as needs_reauth and the user is asked to reconnect.
 */
export class OneNoteReauthRequiredError extends Error {
  constructor(message = 'The Microsoft connection needs to be authorized again') {
    super(message);
    this.name = 'OneNoteReauthRequiredError';
  }
}

/** Graph refused in a way no retry fixes: a bad request, or a resource that is gone. */
export class GraphRequestFailedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GraphRequestFailedError';
  }
}

/**
 * Still throttled after this call's own retries. Retryable, but not here: the job's
 * backoff waits it out without holding a worker slot.
 */
export class GraphThrottledError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GraphThrottledError';
  }
}
