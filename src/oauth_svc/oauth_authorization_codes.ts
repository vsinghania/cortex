import { OAuthTokenIssuer } from './oauth_token_issuer.js';
import type { OAuthAuthorizationCodeRepository } from './repositories/oauth_authorization_code_repository_interface.js';
import type { CreateOAuthAuthorizationCodeInput, OAuthAuthorizationCode } from './types/oauth.types.js';

export type IssueOAuthAuthorizationCodeInput = Omit<CreateOAuthAuthorizationCodeInput, 'code_hash' | 'expires_at'> & { now: Date };

/** The only way to `oauth_authorization_codes`. Callers handle raw codes; only their hashes are stored. */
export class OAuthAuthorizationCodes {
  constructor(private readonly repo: OAuthAuthorizationCodeRepository) {}

  /** Returns the raw code, which exists only in the redirect to the client. */
  async issue(input: IssueOAuthAuthorizationCodeInput): Promise<string> {
    const { now, ...code } = input;
    const issued = OAuthTokenIssuer.authorizationCode(now);
    await this.repo.create({ ...code, code_hash: issued.hash, expires_at: issued.expires_at });
    return issued.value;
  }

  /** Any code with this value, used or not: how a replay is recognised. */
  find(code: string): Promise<OAuthAuthorizationCode | null> {
    return this.repo.findByHash(OAuthTokenIssuer.hash(code));
  }

  /** Marks an unexpired, unused code consumed by the family it starts; null if another exchange got there first. */
  consume(input: { code: string; client_id: string; now: Date; family_id: string }): Promise<OAuthAuthorizationCode | null> {
    const { code, ...lookup } = input;
    return this.repo.consume({ ...lookup, code_hash: OAuthTokenIssuer.hash(code) });
  }
}
