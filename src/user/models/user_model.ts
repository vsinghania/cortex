import { Schema } from 'mongoose';
import type { User } from '../types/user.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

// Encapsulated Mongoose model factory for the User collection.
// The model is created per-Connection and cached; callers should use the repository to obtain it.
export class UserModelFactory extends BaseModelFactory<User> {

  protected buildSchema(): Schema<User> {
    const UserSchemaMongoose = new Schema(
      {
        user_id: { type: String, required: true, unique: true, index: true }, // UUID
        email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
        name: { type: String, required: true, trim: true },
        // Absent for accounts created through Google sign-in until a password is set via reset.
        password_hash: { type: String, default: undefined },
        google_sub: { type: String, default: undefined },
        roles: { type: [String], default: ['user'] },
        last_login_at: { type: Date, default: undefined },
        email_verified_at: { type: Date, default: undefined },
        email_verification_required: { type: Boolean, default: undefined }
      },
      {
        collection: 'users',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    // Indexes
    UserSchemaMongoose.index({ user_id: 1 }, { unique: true });
    UserSchemaMongoose.index({ email: 1 }, { unique: true });
    UserSchemaMongoose.index({ google_sub: 1 }, { unique: true, sparse: true });

    // Output shaping
    UserSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        // Note: We intentionally keep password_hash at the repository/service layer.
        // Controllers must avoid returning it in API responses.
        return ret;
      }
    });

    return UserSchemaMongoose;
  }

  protected getModelName(): string {
    return 'User';
  }
}
