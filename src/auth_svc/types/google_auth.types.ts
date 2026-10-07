import type { AuthResult } from './auth.types.js';

export type GoogleOAuthConfig = {
  client_id: string;
  client_secret: string;
  /** The API's own callback URL; must match an authorized redirect URI on the Google client. */
  redirect_uri: string;
};

/** Who Google says signed in, after the ID token has been verified. */
export type GoogleIdentity = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
};

/** Held in a short-lived HttpOnly cookie between the redirect to Google and the callback. */
export type GoogleOAuthState = {
  state: string;
  code_verifier: string;
  return_to: string;
};

export type GoogleAuthorization = {
  url: string;
  pending: GoogleOAuthState;
};

export type CompleteGoogleAuthorizationInput = {
  code: string;
  state: string;
  pending: GoogleOAuthState;
};

export type GoogleLoginOutcome = 'existing' | 'linked' | 'created';

export type GoogleAuthResult = AuthResult & { return_to: string };
