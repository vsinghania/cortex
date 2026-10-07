import { Id } from '../lib/id.js';
import type { OAuthTokenRepository } from './repositories/oauth_token_repository_interface.js';
import { OAUTH_ACCESS_TOKEN_TTL_SEC, OAuthTokenIssuer, type IssuedSecret } from './oauth_token_issuer.js';
import type { OAuthGrant, OAuthTokenResponse } from './types/oauth.types.js';

export type IssuedTokens = { family_id: string; access: IssuedSecret; refresh?: IssuedSecret; scopes: string[] };

type IssueInput = {
  grant: OAuthGrant;
  scopes: string[];
  now: Date;
  with_refresh: boolean;
  access_ttl_sec?: number;
};

/** Mints tokens into families: a new family per code exchange, the same family on every refresh. */
export class OAuthTokenFamilies {
  constructor(private readonly tokens: OAuthTokenRepository) {}

  start(input: IssueInput): Promise<IssuedTokens> {
    return this.issue({ ...input, family_id: Id.generateUuidV7() });
  }

  continue(input: IssueInput & { family_id: string }): Promise<IssuedTokens> {
    return this.issue(input);
  }

  static toResponse(issued: IssuedTokens): OAuthTokenResponse {
    return {
      access_token: issued.access.value,
      token_type: 'Bearer',
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SEC,
      ...(issued.refresh ? { refresh_token: issued.refresh.value } : {}),
      scope: issued.scopes.join(' ')
    };
  }

  private async issue(input: IssueInput & { family_id: string }): Promise<IssuedTokens> {
    const access = OAuthTokenIssuer.accessToken(input.now, input.access_ttl_sec);
    const refresh = input.with_refresh ? OAuthTokenIssuer.refreshToken(input.now) : undefined;
    const common = {
      grant_id: input.grant.grant_id,
      family_id: input.family_id,
      user_id: input.grant.user_id,
      client_id: input.grant.client_id,
      scopes: input.scopes,
      resource: input.grant.resource
    };
    await this.tokens.insertMany([
      { ...common, type: 'access', token_hash: access.hash, expires_at: access.expires_at },
      ...(refresh ? [{ ...common, type: 'refresh' as const, token_hash: refresh.hash, expires_at: refresh.expires_at }] : [])
    ]);
    return { family_id: input.family_id, access, refresh, scopes: input.scopes };
  }
}
