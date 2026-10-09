import type { GoogleIdentity } from '../types/google_auth.types.js';

export interface GoogleOAuthAdapterInterface {
  buildAuthorizationUrl(params: { state: string; code_challenge: string }): string;
  /** Trades the callback's code for tokens and returns the verified ID token's identity. */
  exchangeAuthorizationCode(params: { code: string; code_verifier: string }): Promise<GoogleIdentity>;
}
