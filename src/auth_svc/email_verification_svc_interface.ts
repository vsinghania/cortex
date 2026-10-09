export interface EmailVerificationSvcInterface {
  /** Best-effort: a no-op when the user is already verified or a send is in flight. */
  requestVerification(user_id: string): Promise<void>;

  /** For callers without a session. Silent for an unknown email, so it reveals nothing. */
  requestVerificationForEmail(email: string): Promise<void>;

  /** Throws BadRequestError for an invalid, used or expired token. */
  verifyEmailToken(token: string): Promise<void>;
}
