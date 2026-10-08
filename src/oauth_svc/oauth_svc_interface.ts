import type { McpResourceId } from '../mcp/resource/mcp_resource.types.js';
import type {
  ApproveOAuthRequestInput,
  OAuthConsentRequestView,
  PublicMcpResource,
  PublicOAuthGrant
} from './types/oauth.types.js';

/** What the consent page and the Connected apps card need; the protocol side is OAuthAuthorizationServer. */
export interface OAuthSvcInterface {
  describeRequest(request_id: string): Promise<OAuthConsentRequestView>;
  /** Returns where to send the browser: the client's redirect_uri carrying a fresh code. */
  approve(input: ApproveOAuthRequestInput): Promise<{ redirect_url: string }>;
  deny(input: { request_id: string; user_id: string }): Promise<{ redirect_url: string }>;
  listResources(): PublicMcpResource[];
  listGrants(user_id: string): Promise<PublicOAuthGrant[]>;
  revokeGrant(input: { user_id: string; grant_id: string }): Promise<void>;
  /**
   * An access token for one of Cortex's own callers, such as a voice session, so it can
   * reach the public MCP as one user instead of holding the internal service token.
   */
  issueFirstPartyAccessToken(input: FirstPartyTokenRequest): Promise<{ access_token: string; expires_at: Date }>;
}

export type FirstPartyTokenRequest = {
  user_id: string;
  /** Which MCP server the token is for. */
  resource_id: McpResourceId;
  client_id: string;
  client_name: string;
  ttl_sec: number;
};
