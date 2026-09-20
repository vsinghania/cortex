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

  async findByUserId(user_id: string): Promise<OneNoteConnection | null> {
    const found = await this.model.findOne({ user_id }).lean();
    return found ? MongooseUtils.toDomain<OneNoteConnection>(found) : null;
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

    return MongooseUtils.toDomain<OneNoteConnection>(updated);
  }

  async updateTokenCache(params: { user_id: string; token_cache_sealed: string }): Promise<void> {
    await this.model.updateOne(
      { user_id: params.user_id },
      { $set: { token_cache_sealed: params.token_cache_sealed } }
    );
  }

  async updateSelectedNotebooks(params: { user_id: string; notebook_ids: string[] }): Promise<OneNoteConnection | null> {
    const updated = await this.model
      .findOneAndUpdate(
        { user_id: params.user_id },
        { $set: { selected_notebook_ids: params.notebook_ids } },
        { new: true }
      )
      .lean();
    return updated ? MongooseUtils.toDomain<OneNoteConnection>(updated) : null;
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
