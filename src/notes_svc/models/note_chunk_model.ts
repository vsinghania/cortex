import { Schema } from 'mongoose';
import type { NoteChunk } from '../types/note_chunk.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

// Encapsulated Mongoose model factory for Note chunks (phase 2 ready).
// The model is created per-Connection and cached; callers should use repositories to obtain it.
export class NoteChunkModelFactory extends BaseModelFactory<NoteChunk> {

  protected buildSchema(): Schema<NoteChunk> {
    const VectorizationSchema = new Schema(
      {
        status: {
          type: String,
          enum: ['none', 'pending', 'embedded', 'error'],
          default: 'none'
        },
        last_embedded_at: { type: Date, default: undefined },
        embedding_model: { type: String, default: undefined }
      },
      { _id: false, id: false }
    );

    const NoteChunkSchemaMongoose = new Schema<NoteChunk>(
      {
        user_id: { type: String, required: true, index: true }, // UUID (domain ID)
        note_id: { type: String, required: true, index: true }, // Domain Note ID (string)
        chunk_index: { type: Number, required: true, index: true }, // 0-based
        content: { type: String, required: true },
        token_count: { type: Number, default: undefined },
        hash: { type: String, default: undefined, index: true },

        vectorization: { type: VectorizationSchema, default: undefined }
      },
      {
        collection: 'note_chunks',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    // Indexes
    NoteChunkSchemaMongoose.index(
      { note_id: 1, chunk_index: 1 },
      { unique: true, name: 'uniq_note_chunk_index' }
    );
    NoteChunkSchemaMongoose.index(
      { user_id: 1, note_id: 1 },
      { name: 'by_user_note' }
    );
    // Optional text index for simple fallback search
    NoteChunkSchemaMongoose.index({ content: 'text' }, { name: 'note_chunk_text_index' });

    // Output shaping
    NoteChunkSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret;
      }
    });

    return NoteChunkSchemaMongoose;
  }

  protected getModelName(): string {
    return 'NoteChunk';
  }
}
