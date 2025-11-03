import type { RefreshSession } from '../types/auth.types.js';

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
}
