import type { Connection } from 'mongoose';
import type { Note } from '../types/note.types.js';
import type { NoteRepository, NoteListParams, NoteListResult } from './note_repository_interface.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { NoteModelFactory } from '../models/index.js';

// Keep domain conversion narrow and consistent
function toDomain(doc: any): Note {
  const obj = typeof doc?.toJSON === 'function' ? doc.toJSON() : doc;
  return obj as Note;
}

export class MongooseNoteRepository implements NoteRepository {
  private static readonly factory = new NoteModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: any
  ) {}

  // Async factory to create a repository bound to a specific db (and optional host/port)
  static async create(params: { db: string; host?: string; port?: number }) {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const model = this.factory.getModel(conn);
    return new MongooseNoteRepository(conn, model);
  }

  async createNote(note: Note): Promise<Note> {
    const created = await this.model.create(note);
    return toDomain(created);
  }

  async getNoteByKey(params: {
    user_id: string;
    source: Note['source'];
    external_id: string;
  }): Promise<Note | null> {
    const found = await this.model.findOne({
      user_id: params.user_id,
      source: params.source,
      external_id: params.external_id
    }).lean();
    return found ? (toDomain(found) as Note) : null;
  }

  async listNotes(params: NoteListParams): Promise<NoteListResult> {
    const limit_raw = params.limit ?? 20;
    const offset_raw = params.offset ?? 0;
    const limit = Math.max(1, Math.min(100, limit_raw));
    const offset = Math.max(0, offset_raw);

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
    console.log(JSON.stringify(items));
    return {
      items: items.map((i: any) => toDomain(i)),
      total
    };
  }

  async updateNoteByKey(params: {
    user_id: string;
    source: Note['source'];
    external_id: string;
    patch: Partial<Note>;
  }): Promise<Note | null> {
    const p = params.patch ?? {};
    const allowed: Partial<Note> = {};

    // whitelist updatable fields
    if (p.title !== undefined) allowed.title = p.title;
    if (p.body_plain !== undefined) allowed.body_plain = p.body_plain;
    if (p.body_markdown !== undefined) allowed.body_markdown = p.body_markdown;
    if (p.tags !== undefined) allowed.tags = p.tags;
    if (p.container !== undefined) allowed.container = p.container;

    if (p.created_at_provider !== undefined) allowed.created_at_provider = p.created_at_provider;
    if (p.updated_at_provider !== undefined) allowed.updated_at_provider = p.updated_at_provider;
    if (p.last_synced_at !== undefined) allowed.last_synced_at = p.last_synced_at;

    if (p.sync_status !== undefined) allowed.sync_status = p.sync_status;
    if (p.is_archived !== undefined) allowed.is_archived = p.is_archived;
    if (p.is_deleted !== undefined) allowed.is_deleted = p.is_deleted;
    if (p.visibility !== undefined) allowed.visibility = p.visibility;

    if (p.metadata !== undefined) allowed.metadata = p.metadata;
    if (p.vectorization !== undefined) allowed.vectorization = p.vectorization;

    const updated = await this.model.findOneAndUpdate(
      {
        user_id: params.user_id,
        source: params.source,
        external_id: params.external_id
      },
      { $set: allowed },
      { new: true }
    ).lean();

    return updated ? (toDomain(updated) as Note) : null;
  }

  async deleteNoteByKey(params: {
    user_id: string;
    source: Note['source'];
    external_id: string;
  }): Promise<boolean> {
    const res = await this.model.deleteOne({
      user_id: params.user_id,
      source: params.source,
      external_id: params.external_id
    });
    return (res.deletedCount ?? 0) > 0;
  }

  async searchNotes(params: {
    user_id: string;
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<NoteListResult> {
    const limit_raw = params.limit ?? 20;
    const offset_raw = params.offset ?? 0;
    const limit = Math.max(1, Math.min(100, limit_raw));
    const offset = Math.max(0, offset_raw);

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
      items: items.map((i: any) => toDomain(i)),
      total
    };
  }
}
