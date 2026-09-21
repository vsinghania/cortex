import type { Connection, Model } from 'mongoose';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { Id } from '../../lib/id.js';
import { OneNoteConnectionModelFactory } from '../models/onenote_connection_model.js';
import {
  OneNoteConnectionStatus,
  type CreateOneNoteConnectionInput,
  type OneNoteConnection
} from '../types/onenote_connection.types.js';
import type { OneNoteConnectionRepository } from './onenote_connection_repository_interface.js';

export class MongooseOneNoteConnectionRepository implements OneNoteConnectionRepository {
  private static readonly factory = new OneNoteConnectionModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: Model<OneNoteConnection>
  ) {}

  static async create(params: { db: string; host?: string; port?: number }): Promise<OneNoteConnectionRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const model = this.factory.getModel(conn);
    return new MongooseOneNoteConnectionRepository(conn, model);
  }

  /**
   * Reads are `.lean()`, which skips Mongoose defaults, so a document written before a
   * field existed comes back without it. Array fields are normalised here rather than at
   * every call site, where a missing one reads as `undefined.length` and takes the page
   * down with it.
   */
  private static toConnection(doc: unknown): OneNoteConnection {
    const connection = MongooseUtils.toDomain<OneNoteConnection>(doc);
    return {
      ...connection,
      scopes: connection.scopes ?? [],
      selected_notebook_ids: connection.selected_notebook_ids ?? [],
      notebooks: connection.notebooks ?? []
    };
  }

  async findByUserId(user_id: string): Promise<OneNoteConnection | null> {
    const found = await this.model.findOne({ user_id }).lean();
    return found ? MongooseOneNoteConnectionRepository.toConnection(found) : null;
  }

  async upsert(input: CreateOneNoteConnectionInput): Promise<OneNoteConnection> {
    const updated = await this.model
      .findOneAndUpdate(
        { user_id: input.user_id },
        {
          $set: {
            microsoft_home_account_id: input.identity.home_account_id,
            microsoft_email: input.identity.email,
            microsoft_name: input.identity.name,
            token_cache_sealed: input.token_cache_sealed,
            scopes: input.scopes,
            status: OneNoteConnectionStatus.Connected
          },
          // A fresh grant clears whatever went wrong last time.
          $unset: { last_error: '', last_error_at: '' },
          $setOnInsert: { id: Id.generateUuidV7(), user_id: input.user_id }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
      .lean();

    return MongooseOneNoteConnectionRepository.toConnection(updated);
  }

  async updateTokenCache(params: { user_id: string; token_cache_sealed: string }): Promise<void> {
    await this.model.updateOne(
      { user_id: params.user_id },
      { $set: { token_cache_sealed: params.token_cache_sealed } }
    );
  }

  async listSyncable(params: { limit: number }): Promise<OneNoteConnection[]> {
    const docs = await this.model
      .find({
        status: OneNoteConnectionStatus.Connected,
        'selected_notebook_ids.0': { $exists: true }
      })
      .limit(params.limit)
      .lean();
    return docs.map((d) => MongooseOneNoteConnectionRepository.toConnection(d));
  }

  async updateSelectedNotebooks(params: { user_id: string; notebook_ids: string[] }): Promise<OneNoteConnection | null> {
    const updated = await this.model
      .findOneAndUpdate(
        { user_id: params.user_id },
        { $set: { selected_notebook_ids: params.notebook_ids } },
        { new: true }
      )
      .lean();
    return updated ? MongooseOneNoteConnectionRepository.toConnection(updated) : null;
  }

  async cacheNotebooks(params: {
    user_id: string;
    notebooks: Array<{ id: string; display_name: string }>;
    cached_at: Date;
  }): Promise<OneNoteConnection | null> {
    const existing = await this.findByUserId(params.user_id);
    if (!existing) return null;

    // Carry each notebook's watermark across the refresh: losing it would make the next
    // pass re-read that notebook's whole history.
    const state_by_id = new Map(existing.notebooks.map((n) => [n.id, n]));
    const notebooks = params.notebooks.map((n) => ({
      id: n.id,
      display_name: n.display_name,
      sync_watermark: state_by_id.get(n.id)?.sync_watermark,
      last_synced_at: state_by_id.get(n.id)?.last_synced_at
    }));

    const updated = await this.model
      .findOneAndUpdate(
        { user_id: params.user_id },
        { $set: { notebooks, notebooks_cached_at: params.cached_at } },
        { new: true }
      )
      .lean();
    return updated ? MongooseOneNoteConnectionRepository.toConnection(updated) : null;
  }

  async updateNotebookSyncState(params: {
    user_id: string;
    notebook_id: string;
    sync_watermark?: Date;
    last_synced_at: Date;
  }): Promise<OneNoteConnection | null> {
    const set: Record<string, unknown> = { 'notebooks.$[nb].last_synced_at': params.last_synced_at };
    if (params.sync_watermark) set['notebooks.$[nb].sync_watermark'] = params.sync_watermark;

    const updated = await this.model
      .findOneAndUpdate({ user_id: params.user_id }, { $set: set }, {
        new: true,
        arrayFilters: [{ 'nb.id': params.notebook_id }]
      })
      .lean();
    return updated ? MongooseOneNoteConnectionRepository.toConnection(updated) : null;
  }

  async updateSyncState(params: {
    user_id: string;
    sync_watermark?: Date;
    last_synced_at?: Date;
  }): Promise<OneNoteConnection | null> {
    const set: Record<string, unknown> = {};
    if (params.sync_watermark) set.sync_watermark = params.sync_watermark;
    if (params.last_synced_at) set.last_synced_at = params.last_synced_at;
    if (Object.keys(set).length === 0) return this.findByUserId(params.user_id);

    const updated = await this.model.findOneAndUpdate({ user_id: params.user_id }, { $set: set }, { new: true }).lean();
    return updated ? MongooseOneNoteConnectionRepository.toConnection(updated) : null;
  }

  async updateStatus(params: {
    user_id: string;
    status: OneNoteConnectionStatus;
    last_error?: string;
  }): Promise<void> {
    const set: Record<string, unknown> = { status: params.status };
    const unset: Record<string, string> = {};

    if (params.last_error) {
      set.last_error = params.last_error;
      set.last_error_at = new Date();
    } else {
      unset.last_error = '';
      unset.last_error_at = '';
    }

    await this.model.updateOne(
      { user_id: params.user_id },
      { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) }
    );
  }

  async deleteByUserId(user_id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ user_id });
    return (result.deletedCount ?? 0) > 0;
  }
}
