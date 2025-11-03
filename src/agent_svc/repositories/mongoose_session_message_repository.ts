import type { Connection, Model } from 'mongoose';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { AgentSessionMessageModelFactory } from '../models/index.js';
import { AgentSessionModelFactory } from '../models/index.js';
import type {
  AgentSessionMessage,
  AppendMessagesInput,
  SessionMessage,
  SessionMessageListParams
} from '../types/session_message.types.js';
import type {
  SessionMessageListResult,
  SessionMessageRepository
} from './session_message_repository_interface.js';
import { v4 as uuidv4 } from 'uuid';

// Narrow conversion helper
function toDomain(doc: any): AgentSessionMessage {
  const obj = typeof doc?.toJSON === 'function' ? doc.toJSON() : doc;
  return obj as AgentSessionMessage;
}

function validateAndNormalizeMessage(
  base: Omit<AgentSessionMessage, 'user_id' | 'session_id'>
): Omit<AgentSessionMessage, 'user_id' | 'session_id'> {
  const msg: Omit<AgentSessionMessage, 'user_id' | 'session_id'> = {
    ...base,
    message_id: base.message_id ?? uuidv4(),
    timestamp: base.timestamp ?? new Date()
  };

  // content validation
  const dt = (msg as any)?.content?.data_type;
  if (dt !== 'json' && dt !== 'string') {
    throw new Error('content.data_type must be "json" or "string"');
  }

  // tool/mcp invariants
  if (msg.model_response_type === 'tool_call') {
    const td = (msg as any)?.content?.tool_details;
    if (!td || !td.tool_name || typeof td.tool_name !== 'string') {
      throw new Error('tool_call requires content.tool_details.tool_name');
    }
  }
  if (msg.model_response_type === 'mcp_call') {
    const md = (msg as any)?.content?.mcp_details;
    if (!md || !md.server_name || !md.tool_name) {
      throw new Error('mcp_call requires content.mcp_details.server_name and .tool_name');
    }
  }

  return msg;
}

export class MongooseSessionMessageRepository implements SessionMessageRepository {
  private static readonly messageFactory = new AgentSessionMessageModelFactory();
  private static readonly sessionFactory = new AgentSessionModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly messageModel: Model<AgentSessionMessage>,
    private readonly sessionModel: Model<any>
  ) {}

  // Async factory
  static async create(params: { db: string; host?: string; port?: number }): Promise<SessionMessageRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const messageModel = this.messageFactory.getModel(conn);
    const sessionModel = this.sessionFactory.getModel(conn);
    return new MongooseSessionMessageRepository(conn, messageModel, sessionModel);
  }

  async appendMessages(input: AppendMessagesInput): Promise<number> {
    const { user_id, session_id } = input;
    const prepared: AgentSessionMessage[] = input.messages.map((m) => {
      const normalized = validateAndNormalizeMessage({
        message_id: (m as any).message_id,
        sender: m.sender,
        agent_context: m.agent_context,
        model_response_type: m.model_response_type,
        content: m.content,
        timestamp: (m as any).timestamp,
        provider_response_id: (m as any).provider_response_id
      });

      return {
        user_id,
        session_id,
        ...normalized
      };
    });

    if (prepared.length === 0) return 0;

    // Insert messages
    const inserted = await this.messageModel.insertMany(prepared, { ordered: true });
    const insertedCount = inserted.length;

    // Update session metadata (message_count, last_message_at)
    const last_ts = prepared.reduce<Date>((acc, cur) => {
      return acc && acc > cur.timestamp ? acc : cur.timestamp;
    }, prepared[0].timestamp);

    await this.sessionModel.findOneAndUpdate(
      { user_id, session_id },
      {
        $inc: { 'metadata.message_count': insertedCount },
        $set: { 'metadata.last_message_at': last_ts }
      },
      { new: false }
    );

    // NOTE: We are intentionally not updating metadata.agents[] in this first pass.
    // It can be added with $addToSet and arrayFilters on agent_id/agent_name in a later iteration.

    return insertedCount;
  }

  async listMessages(params: SessionMessageListParams): Promise<SessionMessageListResult> {
    const limitRaw = params.limit ?? 50;
    const offsetRaw = params.offset ?? 0;
    const limit = Math.max(1, Math.min(200, limitRaw));
    const offset = Math.max(0, offsetRaw);
    const order = params.order === 'desc' ? -1 : 1;

    const filter: any = {
      user_id: params.user_id,
      session_id: params.session_id
    };

    const items = await this.messageModel
      .find(filter)
      .sort({ timestamp: order, message_id: order })
      .skip(offset)
      .limit(limit)
      .lean();

    return {
      items: items.map((i: any) => toDomain(i))
      // total omitted to avoid extra count; can be added if needed
    };
  }

  async getMessageById(params: {
    user_id: string;
    session_id: string;
    message_id: string;
  }): Promise<AgentSessionMessage | null> {
    const found = await this.messageModel
      .findOne({
        user_id: params.user_id,
        session_id: params.session_id,
        message_id: params.message_id
      })
      .lean();
    return found ? (toDomain(found) as AgentSessionMessage) : null;
  }

  async deleteMessages(params: {
    user_id: string;
    session_id: string;
    before?: Date;
    after?: Date;
  }): Promise<number> {
    const { user_id, session_id, before, after } = params;

    const filter: any = { user_id, session_id };
    const timeFilter: any = {};
    if (before instanceof Date) timeFilter.$lt = before;
    if (after instanceof Date) timeFilter.$gt = after;
    if (Object.keys(timeFilter).length > 0) {
      filter.timestamp = timeFilter;
    } else {
      // Guardrail: require at least a boundary to avoid accidental full deletion
      return 0;
    }

    const res = await this.messageModel.deleteMany(filter);
    const deletedCount = res.deletedCount ?? 0;

    if (deletedCount > 0) {
      // Decrement message_count
      await this.sessionModel.findOneAndUpdate(
        { user_id, session_id },
        { $inc: { 'metadata.message_count': -deletedCount } },
        { new: false }
      );

      // Recompute last_message_at (set to latest remaining message timestamp)
      const latest = await this.messageModel
        .find({ user_id, session_id })
        .sort({ timestamp: -1, message_id: -1 })
        .limit(1)
        .lean();

      const latestTs: Date | undefined = latest[0]?.timestamp;
      await this.sessionModel.findOneAndUpdate(
        { user_id, session_id },
        { $set: { 'metadata.last_message_at': latestTs } },
        { new: false }
      );
    }

    return deletedCount;
  }
}

export async function createSessionMessageRepository(params: {
  db: string;
  host?: string;
  port?: number;
}): Promise<SessionMessageRepository> {
  return MongooseSessionMessageRepository.create(params);
}
