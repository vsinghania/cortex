import type { McpTokenVerifier, VerifiedMcpToken } from '../mcp/resource/mcp_token_verifier.js';
import { OAuthStoresLoader, type OAuthStores } from './oauth_stores.js';

/**
 * The authorization server's half of the resource-server contract: an access token is
 * valid while the token is live and its grant still exists. Its effective scopes are
 * what both the token and the grant allow, so narrowing a connection in a later consent
 * narrows every token already issued under it.
 */
export class OAuthAccessTokenVerifier implements McpTokenVerifier {
  constructor(
    private readonly deps: { stores: () => Promise<OAuthStores>; now?: () => Date } = { stores: () => OAuthStoresLoader.getStores() }
  ) {}

  async verifyAccessToken(access_token: string): Promise<VerifiedMcpToken | null> {
    const now = this.deps.now?.() ?? new Date();
    const { tokens, grants } = await this.deps.stores();
    const token = await tokens.findActiveAccessToken({ access_token, now });
    if (!token) return null;
    const grant = await grants.findGrantById(token.grant_id);
    if (!grant) return null;

    grants.recordGrantUse(grant, now);
    return {
      user_id: grant.user_id,
      client_id: grant.client_id,
      grant_id: grant.grant_id,
      scopes: token.scopes.filter((scope) => grant.scopes.includes(scope)),
      resource: token.resource,
      kind: grant.kind
    };
  }
}
