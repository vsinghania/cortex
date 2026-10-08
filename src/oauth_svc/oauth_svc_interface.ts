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
}
