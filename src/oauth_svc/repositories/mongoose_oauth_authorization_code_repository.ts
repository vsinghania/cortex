import type { Model } from 'mongoose';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { OAuthAuthorizationCodeModelFactory } from '../models/oauth_authorization_code_model.js';
import type { CreateOAuthAuthorizationCodeInput, OAuthAuthorizationCode } from '../types/oauth.types.js';
import type { OAuthAuthorizationCodeRepository, OAuthCodeLookup } from './oauth_authorization_code_repository_interface.js';

export class MongooseOAuthAuthorizationCodeRepository implements OAuthAuthorizationCodeRepository {
  private static readonly factory = new OAuthAuthorizationCodeModelFactory();

  private constructor(private readonly model: Model<OAuthAuthorizationCode>) {}

  static async create(params: { db: string }): Promise<OAuthAuthorizationCodeRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    return new MongooseOAuthAuthorizationCodeRepository(this.factory.getModel(conn));
  }

  async createAuthorizationCode(input: CreateOAuthAuthorizationCodeInput): Promise<void> {
    await this.model.create(input);
  }

  async consumeAuthorizationCode(input: OAuthCodeLookup & { family_id: string }): Promise<OAuthAuthorizationCode | null> {
    const consumed = await this.model
      .findOneAndUpdate(
        {
          code_hash: input.code_hash,
          client_id: input.client_id,
          consumed_at: { $exists: false },
          expires_at: { $gt: input.now }
        },
        { $set: { consumed_at: input.now, family_id: input.family_id } },
        { new: true }
      )
      .lean();
    return consumed ? MongooseUtils.toDomain<OAuthAuthorizationCode>(consumed) : null;
  }

  async findAuthorizationCodeByHash(code_hash: string): Promise<OAuthAuthorizationCode | null> {
    const found = await this.model.findOne({ code_hash }).lean();
    return found ? MongooseUtils.toDomain<OAuthAuthorizationCode>(found) : null;
  }
}
