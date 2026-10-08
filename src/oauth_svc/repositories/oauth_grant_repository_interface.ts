import type { OAuthGrant, UpsertOAuthGrantInput } from '../types/oauth.types.js';

export interface OAuthGrantRepository {
  /** One grant per user, client and resource: a new consent replaces the scopes of the old one. */
  upsert(input: UpsertOAuthGrantInput & { grant_id: string }): Promise<OAuthGrant>;
  findById(grant_id: string): Promise<OAuthGrant | null>;
  listExternalByUser(user_id: string): Promise<OAuthGrant[]>;
  deleteExternalForUser(input: { user_id: string; grant_id: string }): Promise<boolean>;
  touchLastUsed(input: { grant_id: string; at: Date }): Promise<void>;
}
