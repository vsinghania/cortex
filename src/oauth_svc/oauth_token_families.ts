import { logger } from '../common/logger.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';
import type { OAuthTokenRepository } from './repositories/oauth_token_repository_interface.js';
import { OAUTH_ACCESS_TOKEN_TTL_SEC, OAuthTokenIssuer, type IssuedSecret } from './oauth_token_issuer.js';
import type { CreateOAuthTokenInput, OAuthGrant, OAuthTokenRecord, OAuthTokenResponse } from './types/oauth.types.js';

export type IssuedTokens = { family_id: string; access: IssuedSecret; refresh?: IssuedSecret; scopes: string[] };

type IssueOAuthTokensInput = {
  grant: OAuthGrant;
  scopes: string[];
  now: Date;
  with_refresh: boolean;
  access_ttl_sec?: number;
};

/**
 * Two refreshes racing on one token are normal (a client retrying a timed-out call).
 * Inside this window the loser is simply refused; after it, a replayed rotated token
 * means it was copied, and its family is revoked.
 */
const REFRESH_REUSE_GRACE_MS = Time.secondsToMs(30);

/**
 * The only way to `oauth_tokens`, so every rule about tokens lives here: a new family
 * per code exchange, the same family on every refresh, single-use refresh tokens, and a
 * replayed one revoking its family. Callers handle raw tokens; only hashes are stored.
 */
export class OAuthTokenFamilies {
  constructor(private readonly tokens: OAuthTokenRepository) {}

  /** A code exchange takes its family's id before it is consumed, so a replayed code can find the tokens it produced. */
  static createTokenFamilyId(): string {
    return Id.generateUuidV7();
  }

  issueTokensInNewFamily(input: IssueOAuthTokensInput): Promise<IssuedTokens> {
    return this.issueTokens({ ...input, family_id: OAuthTokenFamilies.createTokenFamilyId() });
  }

  issueTokensInExistingFamily(input: IssueOAuthTokensInput & { family_id: string }): Promise<IssuedTokens> {
    return this.issueTokens(input);
  }

  /** An access token that is unexpired and not revoked. Its grant is the caller's to check. */
  findActiveAccessToken(input: { access_token: string; now: Date }): Promise<OAuthTokenRecord | null> {
    return this.tokens.findActiveAccessToken({ token_hash: OAuthTokenIssuer.hashSecret(input.access_token), now: input.now });
  }

  /**
   * Consumes a live refresh token for rotation: of two refreshes racing on one token,
   * exactly one gets it. Null for any other token, and a replay of one already rotated
   * revokes its family.
   */
  async consumeRefreshTokenForRotation(input: { refresh_token: string; client_id: string; now: Date }): Promise<OAuthTokenRecord | null> {
    const lookup = { token_hash: OAuthTokenIssuer.hashSecret(input.refresh_token), client_id: input.client_id, now: input.now };
    const consumed = await this.tokens.consumeRefreshTokenForRotation(lookup);
    if (!consumed) await this.handleRefreshTokenReuse(lookup);
    return consumed;
  }

  revokeTokenFamily(input: { family_id: string; now: Date }): Promise<void> {
    return this.tokens.revokeTokenFamily(input);
  }

  /** Revokes the family of whichever token (access or refresh) this is, for this client. */
  revokeTokenFamilyForToken(input: { token: string; client_id: string; now: Date }): Promise<boolean> {
    return this.tokens.revokeTokenFamilyByTokenHash({ token_hash: OAuthTokenIssuer.hashSecret(input.token), client_id: input.client_id, now: input.now });
  }

  deleteTokensForGrant(grant_id: string): Promise<void> {
    return this.tokens.deleteTokensForGrant(grant_id);
  }

  static toOAuthTokenResponse(issued: IssuedTokens): OAuthTokenResponse {
    return {
      access_token: issued.access.value,
      token_type: 'Bearer',
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SEC,
      ...(issued.refresh ? { refresh_token: issued.refresh.value } : {}),
      scope: issued.scopes.join(' ')
    };
  }

  private async issueTokens(input: IssueOAuthTokensInput & { family_id: string }): Promise<IssuedTokens> {
    const access = OAuthTokenIssuer.generateAccessToken(input.now, input.access_ttl_sec);
    const refresh = input.with_refresh ? OAuthTokenIssuer.generateRefreshToken(input.now) : undefined;
    const common = {
      grant_id: input.grant.grant_id,
      family_id: input.family_id,
      user_id: input.grant.user_id,
      client_id: input.grant.client_id,
      scopes: input.scopes,
      resource: input.grant.resource
    };
    const records: CreateOAuthTokenInput[] = [
      { ...common, type: 'access', token_hash: access.hash, expires_at: access.expires_at }
    ];
    if (refresh) {
      records.push({ ...common, type: 'refresh', token_hash: refresh.hash, expires_at: refresh.expires_at });
    }
    await this.tokens.insertTokenRecords(records);
    return { family_id: input.family_id, access, refresh, scopes: input.scopes };
  }

  /**
   * A refresh token that cannot be rotated is expired, revoked, lost a race moments ago,
   * or is a copy being replayed after the real client already rotated it.
   */
  private async handleRefreshTokenReuse(input: { token_hash: string; client_id: string; now: Date }): Promise<void> {
    const token = await this.tokens.findRefreshToken(input);
    if (!token?.rotated_at || token.revoked_at) return;
    if (OAuthTokenFamilies.isWithinRefreshTokenReuseGrace(token.rotated_at, input.now)) {
      logger.info({ client_id: input.client_id, grant_id: token.grant_id, reason: 'lost_race' }, 'oauth token refresh refused');
      return;
    }
    await this.tokens.revokeTokenFamily({ family_id: token.family_id, now: input.now });
    logger.warn({ user_id: token.user_id, client_id: input.client_id, grant_id: token.grant_id }, 'oauth refresh reuse detected');
  }

  private static isWithinRefreshTokenReuseGrace(rotated_at: Date, now: Date): boolean {
    return now.getTime() - rotated_at.getTime() <= REFRESH_REUSE_GRACE_MS;
  }
}
