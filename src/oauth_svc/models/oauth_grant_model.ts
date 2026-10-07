import { Schema } from 'mongoose';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { OAUTH_GRANT_KINDS, type OAuthGrant } from '../types/oauth.types.js';

export class OAuthGrantModelFactory extends BaseModelFactory<OAuthGrant> {
  protected buildSchema(): Schema<OAuthGrant> {
    const schema = new Schema<OAuthGrant>(
      {
        grant_id: { type: String, required: true },
        user_id: { type: String, required: true },
        client_id: { type: String, required: true },
        client_name: { type: String, required: true },
        client_host: { type: String },
        kind: { type: String, required: true, enum: OAUTH_GRANT_KINDS },
        scopes: { type: [String], required: true },
        resource: { type: String, required: true },
        last_used_at: { type: Date }
      },
      {
        collection: 'oauth_grants',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    schema.index({ grant_id: 1 }, { unique: true, name: 'uniq_oauth_grant_id' });
    // One consent per user and client: reconnecting updates it instead of adding another.
    schema.index({ user_id: 1, client_id: 1 }, { unique: true, name: 'uniq_oauth_grant_user_client' });
    schema.set('toJSON', { transform: (_doc, ret) => MongooseUtils.stripMongoFields(ret) });

    return schema;
  }

  protected getModelName(): string {
    return 'OAuthGrant';
  }
}
