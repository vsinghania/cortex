import { Schema } from 'mongoose';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { OAUTH_TOKEN_TYPES, type OAuthTokenRecord } from '../types/oauth.types.js';

export class OAuthTokenModelFactory extends BaseModelFactory<OAuthTokenRecord> {
  protected buildSchema(): Schema<OAuthTokenRecord> {
    const schema = new Schema<OAuthTokenRecord>(
      {
        token_hash: { type: String, required: true },
        type: { type: String, required: true, enum: OAUTH_TOKEN_TYPES },
        grant_id: { type: String, required: true },
        family_id: { type: String, required: true },
        user_id: { type: String, required: true },
        client_id: { type: String, required: true },
        scopes: { type: [String], required: true },
        resource: { type: String, required: true },
        expires_at: { type: Date, required: true },
        rotated_at: { type: Date },
        revoked_at: { type: Date }
      },
      {
        collection: 'oauth_tokens',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: false }
      }
    );

    schema.index({ token_hash: 1 }, { unique: true, name: 'uniq_oauth_token_hash' });
    schema.index({ family_id: 1 }, { name: 'by_oauth_token_family' });
    schema.index({ grant_id: 1 }, { name: 'by_oauth_token_grant' });
    // Rotated refresh tokens stay until their own expiry, which is what lets a replay be recognised.
    schema.index({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'oauth_token_ttl' });
    schema.set('toJSON', { transform: (_doc, ret) => MongooseUtils.stripMongoFields(ret) });

    return schema;
  }

  protected getModelName(): string {
    return 'OAuthToken';
  }
}
