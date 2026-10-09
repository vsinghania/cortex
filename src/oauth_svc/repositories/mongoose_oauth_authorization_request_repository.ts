import type { Model } from 'mongoose';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { OAuthAuthorizationRequestModelFactory } from '../models/oauth_authorization_request_model.js';
import type { CreateOAuthAuthorizationRequestInput, OAuthAuthorizationRequest } from '../types/oauth.types.js';
import type { OAuthAuthorizationRequestRepository } from './oauth_authorization_request_repository_interface.js';

export class MongooseOAuthAuthorizationRequestRepository implements OAuthAuthorizationRequestRepository {
  private static readonly factory = new OAuthAuthorizationRequestModelFactory();

  private constructor(private readonly model: Model<OAuthAuthorizationRequest>) {}

  static async create(params: { db: string }): Promise<OAuthAuthorizationRequestRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    return new MongooseOAuthAuthorizationRequestRepository(this.factory.getModel(conn));
  }

  async createAuthorizationRequest(input: CreateOAuthAuthorizationRequestInput): Promise<void> {
    await this.model.create(input);
  }

  async findActiveAuthorizationRequest(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null> {
    const found = await this.model.findOne({ request_id: input.request_id, expires_at: { $gt: input.now } }).lean();
    return found ? MongooseUtils.toDomain<OAuthAuthorizationRequest>(found) : null;
  }

  // Expiry is checked here rather than left to the TTL reaper, which only runs about once a minute.
  async consumeAuthorizationRequest(input: { request_id: string; now: Date }): Promise<OAuthAuthorizationRequest | null> {
    const consumed = await this.model
      .findOneAndDelete({ request_id: input.request_id, expires_at: { $gt: input.now } })
      .lean();
    return consumed ? MongooseUtils.toDomain<OAuthAuthorizationRequest>(consumed) : null;
  }
}
