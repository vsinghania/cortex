import { Schema } from 'mongoose';
import type { Note } from '../types/note.types.js';
import { NoteSource, SyncStatus } from '../types/note.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

// Encapsulated Mongoose model factory for the Note collection.
// The model is created per-Connection and cached; callers should use repositories to obtain it.
export class NoteModelFactory extends BaseModelFactory<Note> {

  /**
   * strength 2 = case-insensitive, accent-sensitive. Shared by the tag index below and
   * every tag query, since Mongo only uses a collated index when the query asks for the
   * same collation.
   */
  static readonly CASE_INSENSITIVE_COLLATION = { locale: 'en', strength: 2 } as const;

  protected buildSchema(): Schema<Note> {
    // Subdocuments
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
        // Adapter-specific payload; keep unstructured
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

    const NoteSchemaMongoose = new Schema<Note>(
      {
        id: { type: String, required: true, unique: true, index: true }, // domain ID (nanoid)
        user_id: { type: String, required: true, index: true }, // UUID (domain ID)
        source: { type: String, enum: Object.values(NoteSource), required: true, index: true },
        external_id: { type: String, default: undefined, index: true },

        title: { type: String, required: true, default: '' },
        body: { type: String, required: true, default: '' },
        body_raw: { type: String, default: undefined },

        tags: { type: [String], default: [] },

        container: { type: ContainerSchema, default: undefined },

        provider_created_at: { type: Date, default: undefined },
        provider_updated_at: { type: Date, default: undefined },
        last_synced_at: { type: Date, default: undefined },

        sync_status: { type: String, enum: Object.values(SyncStatus), default: SyncStatus.Idle },

        is_archived: { type: Boolean, default: false },
        is_pinned: { type: Boolean, default: false },
        is_deleted: { type: Boolean, default: false },

        metadata: { type: MetadataSchema, default: undefined },
        vectorization: { type: VectorizationSchema, default: undefined }
      },
      {
        collection: 'notes',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    // Indexes
    // Partial unique on the source-keyed identity; only enforced when external_id is present.
    NoteSchemaMongoose.index(
      { user_id: 1, source: 1, external_id: 1 },
      {
        unique: true,
        name: 'uniq_user_source_external',
        partialFilterExpression: { external_id: { $exists: true, $type: 'string' } }
      }
    );
    NoteSchemaMongoose.index(
      { user_id: 1, provider_updated_at: -1 },
      { name: 'by_user_provider_updated' }
    );
    NoteSchemaMongoose.index({ user_id: 1, last_synced_at: -1 }, { name: 'by_user_last_synced' });
    // Multikey over `tags`; also covers the tag-facet aggregation, which reads keys only.
    NoteSchemaMongoose.index(
      { user_id: 1, tags: 1, updated_at: -1 },
      { name: 'by_user_tags_updated', collation: NoteModelFactory.CASE_INSENSITIVE_COLLATION }
    );
    // List sorts: pinned notes lead every ordering, and archived notes are excluded by default.
    NoteSchemaMongoose.index(
      { user_id: 1, is_archived: 1, is_pinned: -1, updated_at: -1 },
      { name: 'by_user_archived_pinned_updated' }
    );
    NoteSchemaMongoose.index(
      { user_id: 1, is_archived: 1, is_pinned: -1, created_at: -1 },
      { name: 'by_user_archived_pinned_created' }
    );
    NoteSchemaMongoose.index(
      { user_id: 1, is_archived: 1, is_pinned: -1, title: 1 },
      { name: 'by_user_archived_pinned_title', collation: NoteModelFactory.CASE_INSENSITIVE_COLLATION }
    );
    // Optional text index for basic search/fallbacks
    NoteSchemaMongoose.index({ title: 'text', body: 'text' }, { name: 'note_text_index' });

    // Output shaping: hide Mongo internals; keep domain `id`.
    NoteSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret;
      }
    });

    return NoteSchemaMongoose;
  }

  protected getModelName(): string {
    return 'Note';
  }
}
