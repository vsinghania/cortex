const HEARTBEAT_DIVISOR = 3;
/**
 * The admin re-index endpoint is poll-based, so progress must move visibly even
 * under a long lease. Lease-keeping alone would allow lease_ms/3 - 100s at a
 * 5-minute lease - which would freeze the UI and delay cancellation just as long.
 */
const PROGRESS_FLUSH_MS = 10_000;

export class JobLease {
  private constructor() {}

  static expiryAt(params: { now: Date; lease_ms: number }): Date {
    return new Date(params.now.getTime() + params.lease_ms);
  }

  /**
   * A terminal job (visible_at null) is never expired - it is not claimable at all.
   * The boundary is inclusive: visible_at === now means the lease has lapsed, which
   * matches the claim filter's `$lte`.
   */
  static isExpired(params: { visible_at: Date | null; now: Date }): boolean {
    if (!params.visible_at) return false;
    return params.visible_at.getTime() <= params.now.getTime();
  }

  /** The shorter of two-beats-before-expiry and the progress flush interval. */
  static heartbeatIntervalMs(lease_ms: number): number {
    return Math.max(1, Math.min(Math.floor(lease_ms / HEARTBEAT_DIVISOR), PROGRESS_FLUSH_MS));
  }
}
