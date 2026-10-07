import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';
import type { McpTokenVerifier, VerifiedMcpToken } from '../mcp/resource/mcp_token_verifier.js';
import { OAuthTokenIssuer } from './oauth_token_issuer.js';
import { OAuthStoresLoader, type OAuthStores } from './oauth_stores.js';
import type { OAuthGrant } from './types/oauth.types.js';

/** Stops every MCP call from also being a write. */
const LAST_USED_WRITE_INTERVAL_MS = Time.minutesToMs(1);

/**
 * The authorization server's half of the resource-server contract: an access token is
 * valid while the token is live and its grant still exists. Its effective scopes are
 * what both the token and the grant allow, so narrowing a connection in a later consent
 * narrows every token already issued under it.
 */
export class OAuthAccessTokenVerifier implements McpTokenVerifier {
  constructor(
    private readonly deps: { stores: () => Promise<OAuthStores>; now?: () => Date } = { stores: () => OAuthStoresLoader.get() }
  ) {}

  async verify(access_token: string): Promise<VerifiedMcpToken | null> {
    const now = this.deps.now?.() ?? new Date();
    const { tokens, grants } = await this.deps.stores();
    const token = await tokens.findActiveAccess({ token_hash: OAuthTokenIssuer.hash(access_token), now });
    if (!token) return null;
    const grant = await grants.findById(token.grant_id);
    if (!grant) return null;

    this.recordUse(grant, now);
    return {
      user_id: grant.user_id,
      client_id: grant.client_id,
      grant_id: grant.grant_id,
      scopes: token.scopes.filter((scope) => grant.scopes.includes(scope)),
      resource: token.resource,
      kind: grant.kind
    };
  }

  private recordUse(grant: OAuthGrant, now: Date): void {
    const last_used_ms = grant.last_used_at?.getTime() ?? 0;
    if (now.getTime() - last_used_ms < LAST_USED_WRITE_INTERVAL_MS) return;
    void this.touchLastUsed(grant.grant_id, now);
  }

  /** Best effort and not awaited: a missed timestamp must never fail or slow the request it describes. */
  private async touchLastUsed(grant_id: string, at: Date): Promise<void> {
    try {
      const { grants } = await this.deps.stores();
      await grants.touchLastUsed({ grant_id, at });
    } catch (err) {
      logger.debug({ err, grant_id }, 'oauth last-used update skipped');
    }
  }
}
