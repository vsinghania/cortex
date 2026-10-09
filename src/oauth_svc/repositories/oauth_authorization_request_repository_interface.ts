import type { CreateOAuthAuthorizationRequestInput, OAuthAuthorizationRequest } from '../types/oauth.types.js';

export interface OAuthAuthorizationRequestRepository {
  createAuthorizationRequest(input: CreateOAuthAuthorizationRequestInput): Promise<void>;
  findActiveAuthorizationRequest(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null>;
  /** Removes an unexpired request in one write and returns it; null when there is none. */
  consumeAuthorizationRequest(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null>;
}
