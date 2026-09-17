import { Schema } from 'mongoose';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { OneNoteConnectionStatus, type OneNoteConnection } from '../types/onenote_connection.types.js';

// Encapsulated Mongoose model factory for OneNote connections.
// Use repositories to obtain instances; do not export Mongoose models directly.
export class OneNoteConnectionModelFactory extends BaseModelFactory<OneNoteConnection> {

  protected buildSchema(): Schema<OneNoteConnection> {
    const OneNoteConnectionSchemaMongoose = new Schema<OneNoteConnection>(
      {
        id: { type: String, required: true, unique: true }, // UUID v7 (domain ID)

        // One connection per user: connecting a second Microsoft account replaces
        // the first rather than leaving two syncs fighting over the same notes.
        user_id: { type: String, required: true, unique: true },

        microsoft_home_account_id: { type: String, required: true },
        microsoft_email: { type: String, required: true },
        microsoft_name: { type: String, default: undefined },

        // Sealed with SecretBox. Never logged, never returned to the SPA.
        token_cache_sealed: { type: String, required: true },
        scopes: { type: [String], required: true, default: [] },

        status: {
          type: String,
          enum: Object.values(OneNoteConnectionStatus),
          required: true,
          default: OneNoteConnectionStatus.Connected
        },
        last_error: { type: String, default: undefined },
        last_error_at: { type: Date, default: undefined },

        sync_watermark: { type: Date, default: undefined },
        last_synced_at: { type: Date, default: undefined },
        last_full_reconcile_at: { type: Date, default: undefined }
      },
      {
        collection: 'onenote_connections',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    OneNoteConnectionSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret;
      }
    });

    return OneNoteConnectionSchemaMongoose;
  }

  protected getModelName(): string {
    return 'OneNoteConnection';
  }
}
