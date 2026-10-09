import type {
  ApproveOAuthRequestInput,
  FirstPartyTokenRequest,
  OAuthConsentRequestView,
  PublicMcpResource,
  PublicOAuthGrant
} from './types/oauth.types.js';

/** What the consent page and the Connected apps card need; the protocol side is OAuthAuthorizationServer. */
export interface OAuthSvcInterface {
  describeAuthorizationRequest(request_id: string): Promise<OAuthConsentRequestView>;
  /** Returns where to send the browser: the client's redirect_uri carrying a fresh code. */
  approveAuthorizationRequest(input: ApproveOAuthRequestInput): Promise<{ redirect_url: string }>;
  denyAuthorizationRequest(input: { request_id: string; user_id: string }): Promise<{ redirect_url: string }>;
  listMcpResources(): PublicMcpResource[];
  listConnectedAppGrants(user_id: string): Promise<PublicOAuthGrant[]>;
  revokeConnectedAppGrant(input: { user_id: string; grant_id: string }): Promise<void>;
  /**
   * An access token for one of Cortex's own callers, such as a voice session, so it can
   * reach the public MCP as one user instead of holding the internal service token.
   */
  issueFirstPartyAccessToken(input: FirstPartyTokenRequest): Promise<{ access_token: string; expires_at: Date }>;
}
