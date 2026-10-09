import type { ResetPasswordInput } from './types/auth.types.js';

export interface PasswordResetSvcInterface {
  /** Resolves the same way whether or not the account exists, so a caller cannot tell. */
  requestPasswordReset(email: string): Promise<void>;

  /** Throws BadRequestError for an invalid, used or expired token. */
  resetPassword(input: ResetPasswordInput): Promise<void>;
}
