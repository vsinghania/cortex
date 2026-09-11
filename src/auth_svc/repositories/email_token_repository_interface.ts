import type { EmailToken, EmailTokenPurpose } from '../types/email_token.types.js';

export interface EmailTokenRepository {
  /** Deletes the user's existing tokens for this purpose, then stores this one: the latest link wins. */
  replaceForUser(input: {
    user_id: string;
    purpose: EmailTokenPurpose;
    token_hash: string;
    expires_at: Date;
  }): Promise<void>;

  /** Marks an unconsumed, unexpired token consumed in one write; null when there is none. */
  consume(input: { token_hash: string; purpose: EmailTokenPurpose; now: Date }): Promise<EmailToken | null>;
}
