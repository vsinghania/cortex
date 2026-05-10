import type { Connection } from 'mongoose';
import type { Note } from '../types/note.types.js';
import type {
  NoteRepository,
  NoteListParams,
  NoteListResult,
  NoteByIdKey,
  NoteBySourceKey
} from './note_repository_interface.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { NoteModelFactory, NoteTrashModelFactory } from '../models/index.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { logger } from '../../common/logger.js';


export class MongooseNoteRepository implements NoteRepository {
  private static readonly factory = new NoteModelFactory();
  private static readonly trash_factory = new NoteTrashModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: any,
    private readonly trash_model: any
  ) {}

  // Async factory to create a repository bound to a specific db (and optional host/port)
  static async create(params: { db: string; host?: string; port?: number }) {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const model = this.factory.getModel(conn);
    const trash_model = this.trash_factory.getModel(conn);
    return new MongooseNoteRepository(conn, model, trash_model);
  }

  async createNote(note: Note): Promise<Note> {
    const created = await this.model.create(note);
    return MongooseUtils.toDomain<Note>(created);
  }

  async getNoteById(params: NoteByIdKey): Promise<Note | null> {
    const found = await this.model.findOne({
      user_id: params.user_id,
      id: params.id
    }).lean();
    return found ? (MongooseUtils.toDomain<Note>(found) as Note) : null;
  }

  async getNoteByKey(params: NoteBySourceKey): Promise<Note | null> {
    const found = await this.model.findOne({
      user_id: params.user_id,
      source: params.source,
      external_id: params.external_id
    }).lean();
    return found ? (MongooseUtils.toDomain<Note>(found) as Note) : null;
  }

  async getNotesByIds(params: { user_id: string; ids: string[] }): Promise<Note[]> {
    if (params.ids.length === 0) return [];
    const docs = await this.model
      .find({ user_id: params.user_id, id: { $in: params.ids } })
      .lean();
    return docs.map((d: any) => MongooseUtils.toDomain<Note>(d));
  }

  async listNotes(params: NoteListParams): Promise<NoteListResult> {
    const { limit, offset } = MongooseNoteRepository.normalizePagination(params);

    const filter: any = { user_id: params.user_id };
    const useText = !!params.query && !!params.query.trim();
    if (useText) {
      filter.$text = { $search: params.query!.trim() };
    }

    let cursor = this.model.find(filter);
    if (useText) {
      cursor = cursor.select({ score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' }, updated_at: -1 });
    } else {
      cursor = cursor.sort({ updated_at: -1 });
    }

    const [items, total] = await Promise.all([
      cursor.skip(offset).limit(limit).lean(),
      this.model.countDocuments(filter)
    ]);

    return {
      items: items.map((i: any) => MongooseUtils.toDomain<Note>(i)),
      total
    };
  }

  async updateNoteById(params: NoteByIdKey & { patch: Partial<Note> }): Promise<Note | null> {
    const allowed = MongooseNoteRepository.buildAllowedPatch(params.patch);
    const updated = await this.model.findOneAndUpdate(
      { user_id: params.user_id, id: params.id },
      { $set: allowed },
      { new: true }
    ).lean();
    return updated ? (MongooseUtils.toDomain<Note>(updated) as Note) : null;
  }

  async updateNoteByKey(params: NoteBySourceKey & { patch: Partial<Note> }): Promise<Note | null> {
    const allowed = MongooseNoteRepository.buildAllowedPatch(params.patch);
    const updated = await this.model.findOneAndUpdate(
      {
        user_id: params.user_id,
        source: params.source,
        external_id: params.external_id
      },
      { $set: allowed },
      { new: true }
    ).lean();
    return updated ? (MongooseUtils.toDomain<Note>(updated) as Note) : null;
  }

  async deleteNoteById(params: NoteByIdKey): Promise<boolean> {
    return this.snapshotThenDelete({ user_id: params.user_id, id: params.id });
  }

  async deleteNoteByKey(params: NoteBySourceKey): Promise<boolean> {
    return this.snapshotThenDelete({
      user_id: params.user_id,
      source: params.source,
      external_id: params.external_id
    });
  }

  async searchNotes(params: {
    user_id: string;
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<NoteListResult> {
    const { limit, offset } = MongooseNoteRepository.normalizePagination(params);

    const filter: any = {
      user_id: params.user_id,
      $text: { $search: params.query.trim() }
    };

    const [items, total] = await Promise.all([
      this.model.find(filter)
        .select({ score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, updated_at: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      this.model.countDocuments(filter)
    ]);

    return {
      items: items.map((i: any) => MongooseUtils.toDomain<Note>(i)),
      total
    };
  }

  private async snapshotThenDelete(filter: Record<string, unknown>): Promise<boolean> {
    const snapshot = await this.model.findOne(filter).lean();
    if (!snapshot) return false;

    const trash_doc = { ...snapshot, deleted_at: new Date() };
    Reflect.deleteProperty(trash_doc as any, '_id');
    Reflect.deleteProperty(trash_doc as any, '__v');
    await this.trash_model.create(trash_doc);

    try {
      await this.model.deleteOne(filter);
    } catch (err) {
      logger.warn(
        { err, note_id: (snapshot as any).id },
        'note delete failed after trash snapshot was written; trash entry will TTL out'
      );
      throw err;
    }

    return true;
  }

  private static normalizePagination(params: { limit?: number; offset?: number }): { limit: number; offset: number } {
    const limit_raw = params.limit ?? 20;
    const offset_raw = params.offset ?? 0;
    return {
      limit: Math.max(1, Math.min(100, limit_raw)),
      offset: Math.max(0, offset_raw)
    };
  }

  private static buildAllowedPatch(patch: Partial<Note> | undefined): Partial<Note> {
    const p = patch ?? {};
    const allowed: Partial<Note> = {};

    if (p.title !== undefined) allowed.title = p.title;
    if (p.body !== undefined) allowed.body = p.body;
    if (p.body_raw !== undefined) allowed.body_raw = p.body_raw;
    if (p.tags !== undefined) allowed.tags = p.tags;
    if (p.container !== undefined) allowed.container = p.container;

    if (p.provider_created_at !== undefined) allowed.provider_created_at = p.provider_created_at;
    if (p.provider_updated_at !== undefined) allowed.provider_updated_at = p.provider_updated_at;
    if (p.last_synced_at !== undefined) allowed.last_synced_at = p.last_synced_at;

    if (p.sync_status !== undefined) allowed.sync_status = p.sync_status;
    if (p.is_archived !== undefined) allowed.is_archived = p.is_archived;
    if (p.is_deleted !== undefined) allowed.is_deleted = p.is_deleted;

    if (p.metadata !== undefined) allowed.metadata = p.metadata;
    if (p.vectorization !== undefined) allowed.vectorization = p.vectorization;

    return allowed;
  }
}
