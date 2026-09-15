import { Schema } from 'mongoose';
import type { NoteFolder } from '../types/note_folder.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { NoteModelFactory } from './note_model.js';

export class NoteFolderModelFactory extends BaseModelFactory<NoteFolder> {

  protected buildSchema(): Schema<NoteFolder> {
    const schema = new Schema<NoteFolder>(
      {
        id: { type: String, required: true, unique: true, index: true },
        user_id: { type: String, required: true, index: true },
        name: { type: String, required: true },
        // Stored as an explicit null (not absent) so top-level siblings share one unique-index key.
        parent_id: { type: String, default: null },
        ancestor_ids: { type: [String], default: [] }
      },
      {
        collection: 'note_folders',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    schema.index(
      { user_id: 1, parent_id: 1, name: 1 },
      {
        unique: true,
        name: 'uniq_user_parent_name',
        collation: NoteModelFactory.CASE_INSENSITIVE_COLLATION
      }
    );
    schema.index({ user_id: 1, ancestor_ids: 1 }, { name: 'by_user_ancestor' });

    schema.set('toJSON', {
      transform(_doc, ret) {
        return MongooseUtils.stripMongoFields(ret);
      }
    });

    return schema;
  }

  protected getModelName(): string {
    return 'NoteFolder';
  }
}
