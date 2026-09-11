import { Schema } from 'mongoose';
import { EMAIL_TOKEN_PURPOSES, type EmailToken } from '../types/email_token.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

export class EmailTokenModelFactory extends BaseModelFactory<EmailToken> {

  protected buildSchema(): Schema<EmailToken> {
    const EmailTokenSchemaMongoose = new Schema(
      {
        user_id: { type: String, required: true },
        purpose: { type: String, required: true, enum: EMAIL_TOKEN_PURPOSES },
        token_hash: { type: String, required: true },
        expires_at: { type: Date, required: true },
        consumed_at: { type: Date, default: undefined }
      },
      {
        collection: 'email_tokens',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    EmailTokenSchemaMongoose.index({ token_hash: 1 }, { unique: true, name: 'uniq_email_token_hash' });
    EmailTokenSchemaMongoose.index({ user_id: 1, purpose: 1 }, { name: 'by_user_purpose' });
    // Mongo reaps a row once expires_at passes, so used and abandoned tokens never
    // pile up - unlike refresh_tokens, which needs a prune job for the same thing.
    EmailTokenSchemaMongoose.index({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'email_token_ttl' });

    EmailTokenSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        return ret;
      }
    });

    return EmailTokenSchemaMongoose;
  }

  protected getModelName(): string {
    return 'EmailToken';
  }
}
