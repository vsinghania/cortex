import type { Model } from 'mongoose';
import { EmailTokenModelFactory } from '../models/email_token_model.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import type { EmailToken, EmailTokenPurpose } from '../types/email_token.types.js';
import type { EmailTokenRepository } from './email_token_repository_interface.js';

export class MongooseEmailTokenRepository implements EmailTokenRepository {
  private static readonly factory = new EmailTokenModelFactory();

  private constructor(private readonly model: Model<EmailToken>) {}

  static async create(params: { db: string }): Promise<EmailTokenRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    return new MongooseEmailTokenRepository(this.factory.getModel(conn));
  }

  // Two writes, not one atomic swap. Only a second concurrent issue for the same
  // user and purpose could interleave them, and the send job's dedup key rules that out.
  async replaceForUser(input: {
    user_id: string;
    purpose: EmailTokenPurpose;
    token_hash: string;
    expires_at: Date;
  }): Promise<void> {
    await this.model.deleteMany({ user_id: input.user_id, purpose: input.purpose });
    await this.model.create(input);
  }

  // One conditional update, so two submissions of the same link cannot both pass.
  // Expiry is enforced here, not left to the TTL index: its reaper runs about once
  // a minute, so an expired row can still be sitting in the collection.
  async consume(input: { token_hash: string; purpose: EmailTokenPurpose; now: Date }): Promise<EmailToken | null> {
    const consumed = await this.model
      .findOneAndUpdate(
        {
          token_hash: input.token_hash,
          purpose: input.purpose,
          consumed_at: { $exists: false },
          expires_at: { $gt: input.now }
        },
        { $set: { consumed_at: input.now } },
        { new: true }
      )
      .lean();
    return consumed ? MongooseUtils.toDomain<EmailToken>(consumed) : null;
  }
}
