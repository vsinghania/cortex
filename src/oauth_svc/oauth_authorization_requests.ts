import { Id } from '../lib/id.js';
import { OAUTH_AUTHORIZATION_REQUEST_TTL_SEC, OAuthTokenIssuer } from './oauth_token_issuer.js';
import type { OAuthAuthorizationRequestRepository } from './repositories/oauth_authorization_request_repository_interface.js';
import type { CreateOAuthRequestInput, OAuthAuthorizationRequest } from './types/oauth.types.js';

/** The only way to `oauth_authorization_requests`: what `/authorize` asked for, parked while the user signs in and consents. */
export class OAuthAuthorizationRequests {
  constructor(private readonly repo: OAuthAuthorizationRequestRepository) {}

  /** Returns the id the consent page carries in place of the request itself. */
  async createAuthorizationRequest(input: CreateOAuthRequestInput): Promise<string> {
    const { now, ...request } = input;
    const request_id = Id.generateRandom(32);
    await this.repo.createAuthorizationRequest({
      ...request,
      request_id,
      expires_at: OAuthTokenIssuer.calculateExpiryDate(now, OAUTH_AUTHORIZATION_REQUEST_TTL_SEC)
    });
    return request_id;
  }

  findActiveAuthorizationRequest(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null> {
    return this.repo.findActiveAuthorizationRequest(input);
  }

  /** Single use: approving or denying removes it, so a consent link cannot be replayed. */
  consumeAuthorizationRequest(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null> {
    return this.repo.consumeAuthorizationRequest(input);
  }
}
