import { Schema } from 'mongoose';
import type { RefreshSession } from '../types/auth.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

// Encapsulated Mongoose model factory for refresh token sessions.
// Use repositories to obtain instances; do not export Mongoose models directly.
export class RefreshTokenModelFactory extends BaseModelFactory<RefreshSession> {

  protected buildSchema(): Schema<RefreshSession> {
    const RefreshTokenSchemaMongoose = new Schema(
      {
        user_id: { type: String, required: true, index: true }, // UUID (domain ID)
        token_hash: { type: String, required: true, index: true }, // bcrypt hash of opaque token
        user_agent: { type: String, default: undefined },
        ip: { type: String, default: undefined },
        expires_at: { type: Date, required: true, index: true },
        revoked_at: { type: Date, default: undefined, index: true },
        replaced_by: { type: String, default: undefined } // new token identifier (optional)
      },
      {
        collection: 'refresh_tokens',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    // Indexes
    RefreshTokenSchemaMongoose.index({ user_id: 1, expires_at: 1 });
    RefreshTokenSchemaMongoose.index({ token_hash: 1 });

    // Output shaping
    RefreshTokenSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret;
      }
    });

    return RefreshTokenSchemaMongoose;
  }

  protected getModelName(): string {
    return 'RefreshToken';
  }
}
