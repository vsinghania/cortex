import type { CreateOAuthTokenInput, OAuthTokenRecord } from '../types/oauth.types.js';

export interface OAuthTokenRepository {
  insertTokenRecords(tokens: CreateOAuthTokenInput[]): Promise<void>;
  /** An access token that is unexpired and not revoked. */
  findActiveAccessToken(input: { token_hash: string; now: Date }): Promise<OAuthTokenRecord | null>;
  /** A refresh token for this client in any state: rotated and revoked ones too, for replay detection. */
  findRefreshToken(input: { token_hash: string; client_id: string }): Promise<OAuthTokenRecord | null>;
  /**
   * Marks a live refresh token rotated in one write and returns it; null if it is not
   * live. Of two refreshes racing on one token exactly one gets it.
   */
  consumeRefreshTokenForRotation(input: { token_hash: string; client_id: string; now: Date }): Promise<OAuthTokenRecord | null>;
  revokeTokenFamily(input: { family_id: string; now: Date }): Promise<void>;
  /** Revokes the family of whichever token (access or refresh) this is, for this client. */
  revokeTokenFamilyByTokenHash(input: { token_hash: string; client_id: string; now: Date }): Promise<boolean>;
  deleteTokensForGrant(grant_id: string): Promise<void>;
}
