import { Schema } from 'mongoose';
import type { TrashedNote } from '../types/note_trash.types.js';
import { NoteSource, SyncStatus } from '../types/note.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { Time } from '../../lib/time.js';

// Mongoose model factory for soft-deleted notes. The collection mirrors `notes`
// shape plus a `deleted_at` timestamp; a TTL index expires entries after 30 days.
// On hard-delete from `notes`, the repository inserts a snapshot here first.
export class NoteTrashModelFactory extends BaseModelFactory<TrashedNote> {

  protected buildSchema(): Schema<TrashedNote> {
    const ContainerSchema = new Schema(
      {
        container_type: {
          type: String,
          enum: ['notebook', 'database', 'folder', 'page', 'section', 'collection', 'other'],
          required: true
        },
        container_id: { type: String, required: true },
        container_name: { type: String, default: undefined }
      },
      { _id: false, id: false }
    );

    const MetadataSchema = new Schema(
      {
        provider_url: { type: String, default: undefined },
        provider_etag: { type: String, default: undefined },
        extra: { type: Schema.Types.Mixed, default: undefined }
      },
      { _id: false, id: false }
    );

    const VectorizationSchema = new Schema(
      {
        status: {
          type: String,
          enum: ['none', 'pending', 'embedded', 'error'],
          default: 'none'
        },
        last_embedded_at: { type: Date, default: undefined },
        embedding_model: { type: String, default: undefined },
        chunk_count: { type: Number, default: undefined }
      },
      { _id: false, id: false }
    );

    const NoteTrashSchemaMongoose = new Schema<TrashedNote>(
      {
        id: { type: String, required: true, index: true },
        user_id: { type: String, required: true, index: true },
        source: { type: String, enum: Object.values(NoteSource), required: true },
        external_id: { type: String, default: undefined },

        title: { type: String, required: true, default: '' },
        body: { type: String, required: true, default: '' },
        body_raw: { type: String, default: undefined },

        tags: { type: [String], default: [] },

        container: { type: ContainerSchema, default: undefined },
        folder_id: { type: String, default: undefined },

        provider_created_at: { type: Date, default: undefined },
        provider_updated_at: { type: Date, default: undefined },
        last_synced_at: { type: Date, default: undefined },

        sync_status: { type: String, enum: Object.values(SyncStatus), default: SyncStatus.Idle },

        is_archived: { type: Boolean, default: false },
        is_pinned: { type: Boolean, default: false },
        is_deleted: { type: Boolean, default: false },

        metadata: { type: MetadataSchema, default: undefined },
        vectorization: { type: VectorizationSchema, default: undefined },

        created_at: { type: Date, required: true },
        updated_at: { type: Date, required: true },

        deleted_at: { type: Date, required: true }
      },
      {
        collection: 'notes_trash',
        versionKey: false,
        // Live `created_at` / `updated_at` come from the live note snapshot, not Mongoose.
        timestamps: false
      }
    );

    NoteTrashSchemaMongoose.index(
      { user_id: 1, deleted_at: -1 },
      { name: 'by_user_deleted' }
    );
    NoteTrashSchemaMongoose.index(
      { deleted_at: 1 },
      { name: 'note_trash_ttl', expireAfterSeconds: Time.daysToSec(30) }
    );

    NoteTrashSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret;
      }
    });

    return NoteTrashSchemaMongoose;
  }

  protected getModelName(): string {
    return 'NoteTrash';
  }
}
