import type { OAuthGrant, UpsertOAuthGrantInput } from '../types/oauth.types.js';

export interface OAuthGrantRepository {
  /** One grant per user, client and resource: a new consent replaces the scopes of the old one. */
  upsertGrant(input: UpsertOAuthGrantInput & { grant_id: string }): Promise<OAuthGrant>;
  findGrantById(grant_id: string): Promise<OAuthGrant | null>;
  listExternalGrantsForUser(user_id: string): Promise<OAuthGrant[]>;
  deleteExternalGrantForUser(input: { user_id: string; grant_id: string }): Promise<boolean>;
  updateGrantLastUsedAt(input: { grant_id: string; at: Date }): Promise<void>;
}
