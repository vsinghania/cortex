import type { Model } from 'mongoose';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { OAuthTokenModelFactory } from '../models/oauth_token_model.js';
import type { CreateOAuthTokenInput, OAuthTokenRecord } from '../types/oauth.types.js';
import type { OAuthTokenRepository } from './oauth_token_repository_interface.js';

export class MongooseOAuthTokenRepository implements OAuthTokenRepository {
  private static readonly factory = new OAuthTokenModelFactory();

  private constructor(private readonly model: Model<OAuthTokenRecord>) {}

  static async create(params: { db: string }): Promise<OAuthTokenRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    return new MongooseOAuthTokenRepository(this.factory.getModel(conn));
  }

  async insertTokenRecords(tokens: CreateOAuthTokenInput[]): Promise<void> {
    await this.model.insertMany(tokens);
  }

  async findActiveAccessToken(input: { token_hash: string; now: Date }): Promise<OAuthTokenRecord | null> {
    const found = await this.model
      .findOne({ token_hash: input.token_hash, type: 'access', revoked_at: { $exists: false }, expires_at: { $gt: input.now } })
      .lean();
    return found ? MongooseUtils.toDomain<OAuthTokenRecord>(found) : null;
  }

  async findRefreshToken(input: { token_hash: string; client_id: string }): Promise<OAuthTokenRecord | null> {
    const found = await this.model.findOne({ token_hash: input.token_hash, client_id: input.client_id, type: 'refresh' }).lean();
    return found ? MongooseUtils.toDomain<OAuthTokenRecord>(found) : null;
  }

  async consumeRefreshTokenForRotation(input: { token_hash: string; client_id: string; now: Date }): Promise<OAuthTokenRecord | null> {
    const consumed = await this.model
      .findOneAndUpdate(
        {
          token_hash: input.token_hash,
          client_id: input.client_id,
          type: 'refresh',
          rotated_at: { $exists: false },
          revoked_at: { $exists: false },
          expires_at: { $gt: input.now }
        },
        { $set: { rotated_at: input.now } },
        { new: true }
      )
      .lean();
    return consumed ? MongooseUtils.toDomain<OAuthTokenRecord>(consumed) : null;
  }

  async revokeTokenFamily(input: { family_id: string; now: Date }): Promise<void> {
    await this.model.updateMany({ family_id: input.family_id, revoked_at: { $exists: false } }, { $set: { revoked_at: input.now } });
  }

  async findTokenByHash(input: { token_hash: string; client_id: string }): Promise<OAuthTokenRecord | null> {
    const found = await this.model.findOne({ token_hash: input.token_hash, client_id: input.client_id }).lean();
    return found ? MongooseUtils.toDomain<OAuthTokenRecord>(found) : null;
  }

  async deleteTokensForGrant(grant_id: string): Promise<void> {
    await this.model.deleteMany({ grant_id });
  }
}
