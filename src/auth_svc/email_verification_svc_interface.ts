export interface EmailVerificationSvcInterface {
  /** Best-effort: a no-op when the user is already verified or a send is in flight. */
  requestVerification(user_id: string): Promise<void>;

  /** Throws BadRequestError for an invalid, used or expired token. */
  verify(token: string): Promise<void>;
}
