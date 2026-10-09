import { OAuthTokenIssuer } from './oauth_token_issuer.js';
import type { OAuthAuthorizationCodeRepository } from './repositories/oauth_authorization_code_repository_interface.js';
import type { IssueOAuthAuthorizationCodeInput, OAuthAuthorizationCode } from './types/oauth.types.js';

/** The only way to `oauth_authorization_codes`. Callers handle raw codes; only their hashes are stored. */
export class OAuthAuthorizationCodes {
  constructor(private readonly repo: OAuthAuthorizationCodeRepository) {}

  /** Returns the raw code, which exists only in the redirect to the client. */
  async issueAuthorizationCode(input: IssueOAuthAuthorizationCodeInput): Promise<string> {
    const { now, ...code } = input;
    const issued = OAuthTokenIssuer.generateAuthorizationCode(now);
    await this.repo.createAuthorizationCode({ ...code, code_hash: issued.hash, expires_at: issued.expires_at });
    return issued.value;
  }

  /** Any code with this value, used or not: how a replay is recognised. */
  findAuthorizationCode(code: string): Promise<OAuthAuthorizationCode | null> {
    return this.repo.findAuthorizationCodeByHash(OAuthTokenIssuer.hashSecret(code));
  }

  /** Marks an unexpired, unused code consumed by the family it starts; null if another exchange got there first. */
  consumeAuthorizationCode(input: { code: string; client_id: string; now: Date; family_id: string }): Promise<OAuthAuthorizationCode | null> {
    const { code, ...lookup } = input;
    return this.repo.consumeAuthorizationCode({ ...lookup, code_hash: OAuthTokenIssuer.hashSecret(code) });
  }
}
