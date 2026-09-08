import { Schema } from 'mongoose';
import type { NoteChunk } from '../types/note_chunk.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

export class NoteChunkModelFactory extends BaseModelFactory<NoteChunk> {

  protected buildSchema(): Schema<NoteChunk> {
    const VectorizationSchema = new Schema(
      {
        status: {
          type: String,
          enum: ['none', 'pending', 'embedded', 'error'],
          default: 'pending'
        },
        last_embedded_at: { type: Date, default: undefined },
        embedding_model: { type: String, default: undefined }
      },
      { _id: false, id: false }
    );

    const NoteChunkSchemaMongoose = new Schema<NoteChunk>(
      {
        id: { type: String, required: true, unique: true },
        user_id: { type: String, required: true, index: true },
        note_id: { type: String, required: true, index: true },
        chunk_index: { type: Number, required: true },
        content: { type: String, required: true },
        token_count: { type: Number, required: true },
        hash: { type: String, required: true, index: true },
        heading_path: { type: [String], default: undefined },
        start_offset: { type: Number, default: undefined },
        end_offset: { type: Number, default: undefined },

        vectorization: { type: VectorizationSchema, default: undefined }
      },
      {
        collection: 'note_chunks',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    NoteChunkSchemaMongoose.index(
      { note_id: 1, chunk_index: 1 },
      { unique: true, name: 'uniq_note_chunk_index' }
    );
    NoteChunkSchemaMongoose.index(
      { user_id: 1, note_id: 1 },
      { name: 'by_user_note' }
    );
    NoteChunkSchemaMongoose.index({ content: 'text' }, { name: 'note_chunk_text_index' });

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
