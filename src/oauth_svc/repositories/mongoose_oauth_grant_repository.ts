import type { Model } from 'mongoose';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { OAuthGrantModelFactory } from '../models/oauth_grant_model.js';
import type { OAuthGrant, UpsertOAuthGrantInput } from '../types/oauth.types.js';
import type { OAuthGrantRepository } from './oauth_grant_repository_interface.js';

export class MongooseOAuthGrantRepository implements OAuthGrantRepository {
  private static readonly factory = new OAuthGrantModelFactory();

  private constructor(private readonly model: Model<OAuthGrant>) {}

  static async create(params: { db: string }): Promise<OAuthGrantRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    return new MongooseOAuthGrantRepository(this.factory.getModel(conn));
  }

  async upsertGrant(input: UpsertOAuthGrantInput & { grant_id: string }): Promise<OAuthGrant> {
    const { grant_id, user_id, client_id, resource, ...replaced } = input;
    const upserted = await this.model
      .findOneAndUpdate(
        { user_id, client_id, resource },
        { $set: replaced, $setOnInsert: { grant_id, user_id, client_id, resource } },
        { upsert: true, new: true }
      )
      .lean();
    return MongooseUtils.toDomain<OAuthGrant>(upserted);
  }

  async findGrantById(grant_id: string): Promise<OAuthGrant | null> {
    const found = await this.model.findOne({ grant_id }).lean();
    return found ? MongooseUtils.toDomain<OAuthGrant>(found) : null;
  }

  async listExternalGrantsForUser(user_id: string): Promise<OAuthGrant[]> {
    const found = await this.model.find({ user_id, kind: 'external' }).sort({ created_at: -1 }).lean();
    return found.map((grant) => MongooseUtils.toDomain<OAuthGrant>(grant));
  }

  async deleteExternalGrantForUser(input: { user_id: string; grant_id: string }): Promise<boolean> {
    const result = await this.model.deleteOne({ user_id: input.user_id, grant_id: input.grant_id, kind: 'external' });
    return result.deletedCount > 0;
  }

  async updateGrantLastUsedAt(input: { grant_id: string; at: Date }): Promise<void> {
    await this.model.updateOne({ grant_id: input.grant_id }, { $set: { last_used_at: input.at } });
  }
}
