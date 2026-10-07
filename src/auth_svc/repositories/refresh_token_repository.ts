import type { Connection, Model } from 'mongoose';
import { RefreshTokenModelFactory } from '../models/refresh_token_model.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import type { RefreshSession } from '../types/auth.types.js';
import type {
  RefreshTokenRepository as IRefreshTokenRepository,
  UserSessionActivity
} from './refresh_token_repository_interface.js';


export class MongooseRefreshTokenRepository implements IRefreshTokenRepository {
  private static readonly factory = new RefreshTokenModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: Model<RefreshSession>
  ) {}

  static async create(params: { db: string; host?: string; port?: number }): Promise<IRefreshTokenRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const model = this.factory.getModel(conn);
    return new MongooseRefreshTokenRepository(conn, model);
  }

  async createSession(input: {
    user_id: string;
    token_hash: string;
    user_agent?: string | null;
    ip?: string | null;
    expires_at: Date;
  }): Promise<RefreshSession> {
    const created = await this.model.create({
      user_id: input.user_id,
      token_hash: input.token_hash,
      user_agent: input.user_agent ?? undefined,
      ip: input.ip ?? undefined,
      expires_at: input.expires_at
    });
    return MongooseUtils.toDomain<RefreshSession>(created);
  }

  async findByTokenHash(token_hash: string): Promise<RefreshSession | null> {
    const found = await this.model.findOne({ token_hash }).lean();
    return found ? (MongooseUtils.toDomain<RefreshSession>(found) as RefreshSession) : null;
  }

  async revokeByTokenHash(token_hash: string, opts?: { replaced_by?: string }): Promise<boolean> {
    const res = await this.model.updateOne(
      { token_hash, revoked_at: { $exists: false } },
      { $set: { revoked_at: new Date(), ...(opts?.replaced_by ? { replaced_by: opts.replaced_by } : {}) } }
    );
    return (res.modifiedCount ?? 0) > 0;
  }

  async rotateSession(params: {
    old_token_hash: string;
    new_token_hash: string;
    new_expires_at: Date;
  }): Promise<RefreshSession | null> {
    // Mark old token revoked, create new one. Caller should handle transaction if strict atomicity is required.
    const old = await this.model.findOneAndUpdate(
      { token_hash: params.old_token_hash, revoked_at: { $exists: false } },
      { $set: { revoked_at: new Date(), replaced_by: params.new_token_hash } },
      { new: true }
    ).lean();

    if (!old) return null;

    const created = await this.model.create({
      user_id: old.user_id,
      token_hash: params.new_token_hash,
      user_agent: old.user_agent,
      ip: old.ip,
      expires_at: params.new_expires_at
    });
    return MongooseUtils.toDomain<RefreshSession>(created);
  }

  async revokeAllForUser(user_id: string): Promise<number> {
    const res = await this.model.updateMany(
      { user_id, revoked_at: { $exists: false } },
      { $set: { revoked_at: new Date() } }
    );
    return res.modifiedCount ?? 0;
  }

  /** Unscoped by design - see UserSessionActivity. */
  async latestActivityByUser(user_ids: string[]): Promise<UserSessionActivity[]> {
    if (user_ids.length === 0) return [];
    return this.model.aggregate<UserSessionActivity>([
      { $match: { user_id: { $in: user_ids } } },
      { $group: { _id: '$user_id', last_active_at: { $max: '$updated_at' } } },
      { $project: { _id: 0, user_id: '$_id', last_active_at: 1 } }
    ]);
  }

  async pruneExpired(limit = 1000): Promise<number> {
    const now = new Date();
    const toDelete = await this.model.find({ expires_at: { $lte: now } }).limit(limit).select({ token_hash: 1 }).lean();
    if (toDelete.length === 0) return 0;
    const res = await this.model.deleteMany({ token_hash: { $in: toDelete.map((d: any) => d.token_hash) } });
    return res.deletedCount ?? 0;
  }
}
