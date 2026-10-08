import { Id } from '../lib/id.js';
import { OAUTH_AUTHORIZATION_REQUEST_TTL_SEC, OAuthTokenIssuer } from './oauth_token_issuer.js';
import type { OAuthAuthorizationRequestRepository } from './repositories/oauth_authorization_request_repository_interface.js';
import type { CreateOAuthAuthorizationRequestInput, OAuthAuthorizationRequest } from './types/oauth.types.js';

export type ParkOAuthAuthorizationRequestInput = Omit<CreateOAuthAuthorizationRequestInput, 'request_id' | 'expires_at'> & {
  now: Date;
};

/** The only way to `oauth_authorization_requests`: what `/authorize` asked for, parked while the user signs in and consents. */
export class OAuthAuthorizationRequests {
  constructor(private readonly repo: OAuthAuthorizationRequestRepository) {}

  /** Returns the id the consent page carries in place of the request itself. */
  async park(input: ParkOAuthAuthorizationRequestInput): Promise<string> {
    const { now, ...request } = input;
    const request_id = Id.generateRandom(32);
    await this.repo.create({
      ...request,
      request_id,
      expires_at: OAuthTokenIssuer.expiresAfter(now, OAUTH_AUTHORIZATION_REQUEST_TTL_SEC)
    });
    return request_id;
  }

  findActive(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null> {
    return this.repo.findActive(input);
  }

  /** Single use: approving or denying removes it, so a consent link cannot be replayed. */
  consume(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null> {
    return this.repo.consume(input);
  }
}
