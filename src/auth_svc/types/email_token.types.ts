/**
 * What a token proves. Adding one also needs a TTL (EmailTokenIssuer), a link
 * (AppLinks) and a renderer (EmailTokenSender) - the compiler points at each.
 */
export const EMAIL_TOKEN_PURPOSES = ['password_reset'] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

export type EmailToken = {
  user_id: string;
  purpose: EmailTokenPurpose;
  /** SHA-256 of the raw token. The raw value exists only in the email. */
  token_hash: string;
  expires_at: Date;
  consumed_at?: Date;
  created_at: Date;
  updated_at: Date;
};
