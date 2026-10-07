import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { MongooseOAuthAuthorizationCodeRepository } from './repositories/mongoose_oauth_authorization_code_repository.js';
import { MongooseOAuthAuthorizationRequestRepository } from './repositories/mongoose_oauth_authorization_request_repository.js';
import { MongooseOAuthGrantRepository } from './repositories/mongoose_oauth_grant_repository.js';
import { MongooseOAuthTokenRepository } from './repositories/mongoose_oauth_token_repository.js';
import type { OAuthAuthorizationCodeRepository } from './repositories/oauth_authorization_code_repository_interface.js';
import type { OAuthAuthorizationRequestRepository } from './repositories/oauth_authorization_request_repository_interface.js';
import type { OAuthGrantRepository } from './repositories/oauth_grant_repository_interface.js';
import type { OAuthTokenRepository } from './repositories/oauth_token_repository_interface.js';

export type OAuthStores = {
  requests: OAuthAuthorizationRequestRepository;
  codes: OAuthAuthorizationCodeRepository;
  grants: OAuthGrantRepository;
  tokens: OAuthTokenRepository;
};

/**
 * The OAuth routes are mounted when the app is assembled, before Mongo is necessarily
 * reachable, so the repositories are opened on first use instead.
 */
export class OAuthStoresLoader {
  private static instance?: Promise<OAuthStores>;

  private constructor() {}

  static get(): Promise<OAuthStores> {
    if (!OAuthStoresLoader.instance) {
      OAuthStoresLoader.instance = OAuthStoresLoader.loadInstance();
    }
    return OAuthStoresLoader.instance;
  }

  private static async loadInstance(): Promise<OAuthStores> {
    try {
      const params = { db: DbNameResolver.resolve('auth') };
      const [requests, codes, grants, tokens] = await Promise.all([
        MongooseOAuthAuthorizationRequestRepository.create(params),
        MongooseOAuthAuthorizationCodeRepository.create(params),
        MongooseOAuthGrantRepository.create(params),
        MongooseOAuthTokenRepository.create(params)
      ]);
      return { requests, codes, grants, tokens };
    } catch (err) {
      // A failed open must not be cached, or one Mongo blip would disable OAuth until restart.
      OAuthStoresLoader.instance = undefined;
      throw err;
    }
  }
}
