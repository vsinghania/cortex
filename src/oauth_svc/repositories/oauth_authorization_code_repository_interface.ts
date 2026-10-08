import type { CreateOAuthAuthorizationCodeInput, OAuthAuthorizationCode } from '../types/oauth.types.js';

export type OAuthCodeLookup = { code_hash: string; client_id: string; now: Date };

export interface OAuthAuthorizationCodeRepository {
  create(input: CreateOAuthAuthorizationCodeInput): Promise<void>;
  /** Marks an unexpired, unused code consumed in one write, so two exchanges cannot both pass. */
  consume(input: OAuthCodeLookup & { family_id: string }): Promise<OAuthAuthorizationCode | null>;
  /** Any code with this hash, used or not: how a replay is recognised. */
  findByHash(code_hash: string): Promise<OAuthAuthorizationCode | null>;
}
