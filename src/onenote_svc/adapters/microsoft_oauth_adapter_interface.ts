import type { MicrosoftAccessToken, MicrosoftSession } from '../types/onenote_connection.types.js';

/**
 * The Microsoft identity boundary. MSAL owns the token cache, so every method
 * takes or returns the serialized cache rather than raw tokens - the service's
 * only job is to seal it and put it somewhere.
 */
export interface MicrosoftOAuthAdapterInterface {
  /** PKCE codes are generated here; the caller supplies only the state it will check. */
  buildAuthorizationUrl(params: { state: string }): Promise<{ url: string; code_verifier: string }>;

  exchangeAuthorizationCode(params: { code: string; code_verifier: string }): Promise<MicrosoftSession>;

  /** Throws OneNoteReauthRequiredError when the grant is gone rather than merely stale. */
  acquireAccessToken(params: { token_cache: string; home_account_id: string }): Promise<MicrosoftAccessToken>;
}
