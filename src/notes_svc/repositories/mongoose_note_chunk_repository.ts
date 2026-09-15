import type { Connection, Model } from 'mongoose';
import type { NoteChunk } from '../types/note_chunk.types.js';
import type { NoteChunkRepository } from './note_chunk_repository_interface.js';
import { NoteChunkModelFactory } from '../models/note_chunk_model.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';

export class MongooseNoteChunkRepository implements NoteChunkRepository {
  private static readonly factory = new NoteChunkModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: Model<NoteChunk>
  ) {}

  static async create(params: { db: string; host?: string; port?: number }): Promise<MongooseNoteChunkRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const model = MongooseNoteChunkRepository.factory.getModel(conn);
    return new MongooseNoteChunkRepository(conn, model);
  }

  async upsertChunks(chunks: NoteChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const ops = chunks.map((chunk) => ({
      updateOne: {
        filter: { note_id: chunk.note_id, chunk_index: chunk.chunk_index },
        update: { $set: chunk },
        upsert: true
      }
    }));
    await this.model.bulkWrite(ops, { ordered: false });
  }

  async getChunksByNote(params: { user_id: string; note_id: string }): Promise<NoteChunk[]> {
    const docs = await this.model
      .find({ user_id: params.user_id, note_id: params.note_id })
      .sort({ chunk_index: 1 })
      .lean();
    return docs.map((d: any) => MongooseUtils.toDomain<NoteChunk>(d));
  }

  async getChunksByIds(params: { user_id: string; ids: string[] }): Promise<NoteChunk[]> {
    if (params.ids.length === 0) return [];
    const docs = await this.model
      .find({ user_id: params.user_id, id: { $in: params.ids } })
      .lean();
    return docs.map((d: any) => MongooseUtils.toDomain<NoteChunk>(d));
  }

  async deleteByNoteId(params: { user_id: string; note_id: string }): Promise<string[]> {
    const docs = await this.model
      .find({ user_id: params.user_id, note_id: params.note_id })
      .select({ id: 1 })
      .lean();
    const ids = docs.map((d: any) => d.id as string);
    if (ids.length === 0) return [];
    await this.model.deleteMany({ user_id: params.user_id, note_id: params.note_id });
    return ids;
  }

  async deleteByNoteIds(params: { user_id: string; note_ids: string[] }): Promise<number> {
    if (params.note_ids.length === 0) return 0;
    const res = await this.model.deleteMany({ user_id: params.user_id, note_id: { $in: params.note_ids } });
    return res.deletedCount ?? 0;
  }

  async deleteByIds(params: { user_id: string; ids: string[] }): Promise<number> {
    if (params.ids.length === 0) return 0;
    const res = await this.model.deleteMany({ user_id: params.user_id, id: { $in: params.ids } });
    return res.deletedCount ?? 0;
  }
}
