import { Schema } from 'mongoose';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import type { OAuthAuthorizationCode } from '../types/oauth.types.js';

export class OAuthAuthorizationCodeModelFactory extends BaseModelFactory<OAuthAuthorizationCode> {
  protected buildSchema(): Schema<OAuthAuthorizationCode> {
    const schema = new Schema<OAuthAuthorizationCode>(
      {
        code_hash: { type: String, required: true },
        client_id: { type: String, required: true },
        user_id: { type: String, required: true },
        grant_id: { type: String, required: true },
        redirect_uri: { type: String, required: true },
        code_challenge: { type: String, required: true },
        scopes: { type: [String], required: true },
        resource: { type: String, required: true },
        expires_at: { type: Date, required: true },
        consumed_at: { type: Date },
        family_id: { type: String }
      },
      {
        collection: 'oauth_authorization_codes',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: false }
      }
    );

    schema.index({ code_hash: 1 }, { unique: true, name: 'uniq_oauth_code_hash' });
    // Reaped ten minutes after expiry rather than at it, so a code replayed shortly after
    // its exchange is still found and its tokens revoked (OAuth 2.1 §4.1.2).
    schema.index({ expires_at: 1 }, { expireAfterSeconds: 600, name: 'oauth_code_ttl' });
    schema.set('toJSON', { transform: (_doc, ret) => MongooseUtils.stripMongoFields(ret) });

    return schema;
  }

  protected getModelName(): string {
    return 'OAuthAuthorizationCode';
  }
}
