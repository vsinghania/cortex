import type { RefreshSession } from '../types/auth.types.js';

/**
 * Admin-only, and NOT user-scoped. Every refresh writes a session row, so the newest
 * `updated_at` is the last time the user's browser was active - a sign-in is not needed.
 */
export type UserSessionActivity = {
  user_id: string;
  last_active_at: Date;
};

export interface RefreshTokenRepository {
  createSession(input: {
    user_id: string;
    token_hash: string;
    user_agent?: string | null;
    ip?: string | null;
    expires_at: Date;
  }): Promise<RefreshSession>;

  findByTokenHash(token_hash: string): Promise<RefreshSession | null>;

  revokeByTokenHash(token_hash: string, opts?: { replaced_by?: string }): Promise<boolean>;

  rotateSession(params: {
    old_token_hash: string;
    new_token_hash: string;
    new_expires_at: Date;
  }): Promise<RefreshSession | null>;

  revokeAllForUser(user_id: string): Promise<number>;

  pruneExpired(limit?: number): Promise<number>;

  /** Admin users view only - see UserSessionActivity. Users with no session rows are omitted. */
  latestActivityByUser(user_ids: string[]): Promise<UserSessionActivity[]>;
}
