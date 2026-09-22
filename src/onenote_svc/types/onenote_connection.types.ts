export type OneNoteOAuthConfig = {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  authority: string;
};

export enum OneNoteConnectionStatus {
  Connected = 'connected',
  /** The grant was revoked or expired; only the user can fix it, by connecting again. */
  NeedsReauth = 'needs_reauth',
  Error = 'error'
}

export type MicrosoftIdentity = {
  /** MSAL's account key, needed to find the account inside a deserialized cache. */
  home_account_id: string;
  email: string;
  name?: string;
};

/**
 * Held in a short-lived HttpOnly cookie between the redirect to Microsoft and the
 * callback. There is no return_to: the callback always lands back on settings.
 */
export type OneNoteOAuthState = {
  state: string;
  code_verifier: string;
};

export type OneNoteAuthorization = {
  url: string;
  pending: OneNoteOAuthState;
};

/** What a completed authorization yields. `token_cache` is MSAL's serialized cache. */
export type MicrosoftSession = {
  access_token: string;
  identity: MicrosoftIdentity;
  scopes: string[];
  token_cache: string;
};

export type MicrosoftAccessToken = {
  access_token: string;
  /** Set only when MSAL changed the cache, so the common path writes nothing back. */
  token_cache: string | null;
};

export interface OneNoteConnection {
  id: string;
  user_id: string;

  microsoft_home_account_id: string;
  microsoft_email: string;
  microsoft_name?: string;

  /** MSAL's serialized token cache, sealed with SecretBox. Never leaves the service. */
  token_cache_sealed: string;
  scopes: string[];

  status: OneNoteConnectionStatus;
  last_error?: string;
  last_error_at?: Date;

  /** Pages modified after this instant are the ones the next sync has to read. */
  sync_watermark?: Date;
  last_synced_at?: Date;
  last_full_reconcile_at?: Date;

  created_at: Date;
  updated_at: Date;
}

/** The connection as the SPA sees it: no sealed cache, no account key. */
export type PublicOneNoteConnection = Omit<
  OneNoteConnection,
  'token_cache_sealed' | 'microsoft_home_account_id'
>;

export type CreateOneNoteConnectionInput = {
  user_id: string;
  identity: MicrosoftIdentity;
  token_cache_sealed: string;
  scopes: string[];
};
