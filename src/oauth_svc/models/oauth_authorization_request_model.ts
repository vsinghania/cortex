import { Schema } from 'mongoose';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import type { OAuthAuthorizationRequest } from '../types/oauth.types.js';

export class OAuthAuthorizationRequestModelFactory extends BaseModelFactory<OAuthAuthorizationRequest> {
  protected buildSchema(): Schema<OAuthAuthorizationRequest> {
    const schema = new Schema<OAuthAuthorizationRequest>(
      {
        request_id: { type: String, required: true },
        client_id: { type: String, required: true },
        client_name: { type: String, required: true },
        client_host: { type: String, required: true },
        redirect_uri: { type: String, required: true },
        code_challenge: { type: String, required: true },
        state: { type: String },
        requested_scopes: { type: [String], required: true },
        resource: { type: String, required: true },
        expires_at: { type: Date, required: true }
      },
      {
        collection: 'oauth_authorization_requests',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: false }
      }
    );

    schema.index({ request_id: 1 }, { unique: true, name: 'uniq_oauth_request_id' });
    schema.index({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'oauth_request_ttl' });
    schema.set('toJSON', { transform: (_doc, ret) => MongooseUtils.stripMongoFields(ret) });

    return schema;
  }

  protected getModelName(): string {
    return 'OAuthAuthorizationRequest';
  }
}
