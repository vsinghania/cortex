import type { Connection, Model } from 'mongoose';
import type { AgentSession, CreateSessionInput, UpdateSessionPatch } from '../types/session.types.js';
import type { SessionRepository, SessionListParams, SessionListResult } from './session_repository_interface.js';
import { AgentSessionModelFactory } from '../models/index.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';

export class MongooseSessionRepository implements SessionRepository {
  private static readonly factory = new AgentSessionModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: Model<AgentSession>
  ) {}

  // Async factory to create a repository bound to a specific db (and optional host/port)
  static async create(params: { db: string; host?: string; port?: number }): Promise<SessionRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const model = this.factory.getModel(conn);
    return new MongooseSessionRepository(conn, model);
  }

  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    const created = await this.model.create({
      user_id: input.user_id,
      session_id: input.session_id,
      session_name: input.session_name,
      live_mode: input.live_mode,
      is_archived: input.is_archived ?? false,
      metadata: input.metadata ?? { message_count: 0 }
    });
    return MongooseUtils.toDomain<AgentSession>(created);
  }

  async getByKey(params: { user_id: string; session_id: string }): Promise<AgentSession | null> {
    const found = await this.model.findOne({
      user_id: params.user_id,
      session_id: params.session_id
    }).lean();
    return found ? (MongooseUtils.toDomain<AgentSession>(found) as AgentSession) : null;
  }

  async listSessions(params: SessionListParams): Promise<SessionListResult> {
    const limit_raw = params.limit ?? 20;
    const offset_raw = params.offset ?? 0;
    const limit = Math.max(1, Math.min(100, limit_raw));
    const offset = Math.max(0, offset_raw);

    const filter: any = { user_id: params.user_id };
    if (params.live_mode) filter.live_mode = params.live_mode;
    if (typeof params.is_archived === 'boolean') filter.is_archived = params.is_archived;

    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ updated_at: -1 }).skip(offset).limit(limit).lean(),
      this.model.countDocuments(filter)
    ]);

    return {
      items: items.map((i: any) => MongooseUtils.toDomain<AgentSession>(i)),
      total
    };
  }

  async updateMeta(params: {
    user_id: string;
    session_id: string;
    patch: UpdateSessionPatch;
  }): Promise<AgentSession | null> {
    const p = params.patch ?? {};
    const allowed: UpdateSessionPatch = {};
    if (p.session_name !== undefined) allowed.session_name = p.session_name;
    if (p.live_mode !== undefined) allowed.live_mode = p.live_mode;
    if (p.is_archived !== undefined) allowed.is_archived = p.is_archived;

    const updated = await this.model.findOneAndUpdate(
      { user_id: params.user_id, session_id: params.session_id },
      { $set: allowed },
      { new: true }
    ).lean();

    return updated ? (MongooseUtils.toDomain<AgentSession>(updated) as AgentSession) : null;
  }

  async deleteByKey(params: { user_id: string; session_id: string }): Promise<boolean> {
    const res = await this.model.deleteOne({
      user_id: params.user_id,
      session_id: params.session_id
    });
    return (res.deletedCount ?? 0) > 0;
  }
}
