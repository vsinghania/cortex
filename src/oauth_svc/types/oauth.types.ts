import type { McpAccess, McpResourceId } from '../../mcp/resource/mcp_resource.types.js';

/** A client resolved from its Client ID Metadata Document. Never stored: re-resolved (and cached) on use. */
export type OAuthClient = {
  /** The https URL of the metadata document. */
  client_id: string;
  /** Self-declared by the client, so shown as a claim, never trusted. */
  client_name: string;
  /** The host of the client_id URL: the one identity on the consent screen a client cannot fake. */
  client_host: string;
  redirect_uris: string[];
  allows_refresh: boolean;
};

/** What `/authorize` asked for, parked while the user signs in and consents. */
export type OAuthAuthorizationRequest = {
  request_id: string;
  client_id: string;
  client_name: string;
  client_host: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  requested_scopes: string[];
  resource: string;
  expires_at: Date;
  created_at: Date;
};

export type CreateOAuthAuthorizationRequestInput = Omit<OAuthAuthorizationRequest, 'created_at'>;

export type OAuthAuthorizationCode = {
  /** SHA-256 of the code. The raw value exists only in the redirect to the client. */
  code_hash: string;
  client_id: string;
  user_id: string;
  grant_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[];
  resource: string;
  expires_at: Date;
  /** Set when exchanged. Kept so a second exchange can be recognised and its tokens revoked. */
  consumed_at?: Date;
  /** The token family the exchange created. */
  family_id?: string;
  created_at: Date;
};

export type CreateOAuthAuthorizationCodeInput = Omit<OAuthAuthorizationCode, 'created_at' | 'consumed_at' | 'family_id'>;

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

/** The shape Settings shows; never carries a token or its hash. */
export type PublicOAuthGrant = {
  grant_id: string;
  client_name: string;
  client_host: string | null;
  /** Which MCP server the connection is for; null if that server is no longer served. */
  resource_id: McpResourceId | null;
  resource_name: string | null;
  scopes: string[];
  created_at: Date;
  last_used_at: Date | null;
};

/** A public MCP server as Settings lists it: what to call it and the URL to paste into an assistant. */
export type PublicMcpResource = { id: McpResourceId; name: string; url: string };

/** One choice on the consent screen, worded by the resource it grants access to. */
export type OAuthAccessOption = {
  value: McpAccess;
  label: string;
  detail: string;
  /** False when the client did not ask for this much: consent never grants more than was requested. */
  available: boolean;
};

/** Everything the consent page shows, so the page itself knows nothing about any one resource. */
export type OAuthConsentRequestView = {
  request_id: string;
  client_name: string;
  client_host: string;
  redirect_host: string;
  resource: { id: McpResourceId; name: string };
  requested_scopes: string[];
  access_options: OAuthAccessOption[];
  default_access: McpAccess;
};

export type ApproveOAuthRequestInput = {
  request_id: string;
  user_id: string;
  access: McpAccess;
};

/** RFC 6749 §5.1 token response. */
export type OAuthTokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export type OAuthErrorRedirectInput = {
  redirect_uri: string;
  state?: string;
  error: string;
  description: string;
};
