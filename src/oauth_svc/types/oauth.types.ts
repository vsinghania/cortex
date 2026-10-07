/**
 * `external` grants are connections a user made from ChatGPT, Claude and the like, and
 * are what Settings lists. `first_party` grants are Cortex's own short-lived callers
 * (a voice session) and are never shown.
 */
export const OAUTH_GRANT_KINDS = ['external', 'first_party'] as const;
export type OAuthGrantKind = (typeof OAUTH_GRANT_KINDS)[number];

/**
 * The lasting consent between one user and one client: what the user agreed the client
 * may do. Tokens hang off it; revoking it ends every token, on every device, at once.
 */
export type OAuthGrant = {
  grant_id: string;
  user_id: string;
  client_id: string;
  client_name: string;
  client_host?: string;
  kind: OAuthGrantKind;
  scopes: string[];
  resource: string;
  last_used_at?: Date;
  created_at: Date;
  updated_at: Date;
};

export type UpsertOAuthGrantInput = {
  user_id: string;
  client_id: string;
  client_name: string;
  client_host?: string;
  kind: OAuthGrantKind;
  scopes: string[];
  resource: string;
};

export const OAUTH_TOKEN_TYPES = ['access', 'refresh'] as const;
export type OAuthTokenType = (typeof OAUTH_TOKEN_TYPES)[number];

/**
 * One issued token. Every code exchange starts a family (one device or install); each
 * refresh rotates within it. Replaying a rotated refresh token revokes its family only,
 * so one leaked device does not log out the user's others.
 */
export type OAuthTokenRecord = {
  /** SHA-256 of the token. The raw value is handed to the client once and never stored. */
  token_hash: string;
  type: OAuthTokenType;
  grant_id: string;
  family_id: string;
  user_id: string;
  client_id: string;
  scopes: string[];
  resource: string;
  expires_at: Date;
  /** Refresh tokens only: when it was exchanged for its successor. */
  rotated_at?: Date;
  revoked_at?: Date;
  created_at: Date;
};

export type CreateOAuthTokenInput = Omit<OAuthTokenRecord, 'created_at' | 'rotated_at' | 'revoked_at'>;

/** RFC 6749 §5.1 token response. */
export type OAuthTokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
};
