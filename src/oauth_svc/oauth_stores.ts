import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { MongooseOAuthGrantRepository } from './repositories/mongoose_oauth_grant_repository.js';
import { MongooseOAuthTokenRepository } from './repositories/mongoose_oauth_token_repository.js';
import type { OAuthGrantRepository } from './repositories/oauth_grant_repository_interface.js';
import type { OAuthTokenRepository } from './repositories/oauth_token_repository_interface.js';

export type OAuthStores = {
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
      const [grants, tokens] = await Promise.all([
        MongooseOAuthGrantRepository.create(params),
        MongooseOAuthTokenRepository.create(params)
      ]);
      return { grants, tokens };
    } catch (err) {
      // A failed open must not be cached, or one Mongo blip would disable OAuth until restart.
      OAuthStoresLoader.instance = undefined;
      throw err;
    }
  }
}
