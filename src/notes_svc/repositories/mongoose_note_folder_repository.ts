import type { Model } from 'mongoose';
import type { NoteFolder } from '../types/note_folder.types.js';
import type {
  NoteFolderKey,
  NoteFolderPlacement,
  NoteFolderProviderKey,
  NoteFolderRepository
} from './note_folder_repository_interface.js';
import { NoteFolderModelFactory } from '../models/note_folder_model.js';
import { NoteModelFactory } from '../models/note_model.js';
import { NoteFolderNameTakenError } from '../note_folder_errors.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';

export class MongooseNoteFolderRepository implements NoteFolderRepository {
  private static readonly factory = new NoteFolderModelFactory();

  private constructor(private readonly model: Model<NoteFolder>) {}

  static async create(params: { db: string; host?: string; port?: number }): Promise<MongooseNoteFolderRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    return new MongooseNoteFolderRepository(MongooseNoteFolderRepository.factory.getModel(conn));
  }

  async createFolder(folder: NoteFolder): Promise<NoteFolder> {
    try {
      const created = await this.model.create(folder);
      return MongooseUtils.toDomain<NoteFolder>(created);
    } catch (err) {
      throw MongooseNoteFolderRepository.translateDuplicate(err, folder.name);
    }
  }

  async getFolder(params: NoteFolderKey): Promise<NoteFolder | null> {
    const found = await this.model.findOne({ user_id: params.user_id, id: params.id }).lean();
    return found ? MongooseUtils.toDomain<NoteFolder>(found) : null;
  }

  async findChildByName(params: { user_id: string; parent_id: string | null; name: string }): Promise<NoteFolder | null> {
    const found = await this.model
      .findOne({ user_id: params.user_id, parent_id: params.parent_id, name: params.name })
      .collation(NoteModelFactory.CASE_INSENSITIVE_COLLATION)
      .lean();
    return found ? MongooseUtils.toDomain<NoteFolder>(found) : null;
  }

  async findByProviderKey(params: NoteFolderProviderKey): Promise<NoteFolder | null> {
    const found = await this.model
      .findOne({ user_id: params.user_id, source: params.source, external_id: params.external_id })
      .lean();
    return found ? MongooseUtils.toDomain<NoteFolder>(found) : null;
  }

  async listFolders(params: { user_id: string }): Promise<NoteFolder[]> {
    const docs = await this.model.find({ user_id: params.user_id }).lean();
    return docs.map((d) => MongooseUtils.toDomain<NoteFolder>(d));
  }

  async listDescendants(params: NoteFolderKey): Promise<NoteFolder[]> {
    const docs = await this.model.find({ user_id: params.user_id, ancestor_ids: params.id }).lean();
    return docs.map((d) => MongooseUtils.toDomain<NoteFolder>(d));
  }

  async renameFolder(params: NoteFolderKey & { name: string }): Promise<NoteFolder | null> {
    try {
      const updated = await this.model
        .findOneAndUpdate({ user_id: params.user_id, id: params.id }, { $set: { name: params.name } }, { new: true })
        .lean();
      return updated ? MongooseUtils.toDomain<NoteFolder>(updated) : null;
    } catch (err) {
      throw MongooseNoteFolderRepository.translateDuplicate(err, params.name);
    }
  }

  /**
   * Two writes, not a transaction: the folder moves first so a sibling-name clash fails
   * before anything else changes. Descendants then swap the old ancestor prefix for the
   * new one, keeping their own chain from the moved folder downward.
   */
  async moveFolder(params: { folder: NoteFolder; placement: NoteFolderPlacement }): Promise<NoteFolder | null> {
    const { folder, placement } = params;
    let moved: NoteFolder | null;
    try {
      const updated = await this.model
        .findOneAndUpdate(
          { user_id: folder.user_id, id: folder.id },
          { $set: { parent_id: placement.parent_id, ancestor_ids: placement.ancestor_ids } },
          { new: true }
        )
        .lean();
      moved = updated ? MongooseUtils.toDomain<NoteFolder>(updated) : null;
    } catch (err) {
      throw MongooseNoteFolderRepository.translateDuplicate(err, folder.name);
    }
    if (!moved) return null;

    await this.model.updateMany(
      { user_id: folder.user_id, ancestor_ids: folder.id },
      [
        {
          $set: {
            ancestor_ids: {
              $concatArrays: [
                [...placement.ancestor_ids, folder.id],
                {
                  $slice: [
                    '$ancestor_ids',
                    { $add: [{ $indexOfArray: ['$ancestor_ids', folder.id] }, 1] },
                    { $size: '$ancestor_ids' }
                  ]
                }
              ]
            }
          }
        }
      ],
      { timestamps: false }
    );
    return moved;
  }

  async deleteFolders(params: { user_id: string; ids: string[] }): Promise<number> {
    if (params.ids.length === 0) return 0;
    const res = await this.model.deleteMany({ user_id: params.user_id, id: { $in: params.ids } });
    return res.deletedCount ?? 0;
  }

  private static translateDuplicate(err: unknown, name: string): unknown {
    return MongooseUtils.isDuplicateKeyError(err) ? new NoteFolderNameTakenError(name) : err;
  }
}
