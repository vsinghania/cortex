import type { CreateOAuthAuthorizationRequestInput, OAuthAuthorizationRequest } from '../types/oauth.types.js';

export interface OAuthAuthorizationRequestRepository {
  create(input: CreateOAuthAuthorizationRequestInput): Promise<void>;
  findActive(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null>;
  /** Removes an unexpired request in one write and returns it; null when there is none. */
  consume(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null>;
}
