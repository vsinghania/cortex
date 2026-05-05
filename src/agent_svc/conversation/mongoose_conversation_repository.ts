import type { Connection, Model } from 'mongoose';
import type { Conversation, ConversationMessage } from '../types/conversation.types.js';
import type {
  ConversationRepositoryInterface,
  ListConversationsForUserParams,
} from './conversation_repository_interface.js';
import {
  ConversationMessageModelFactory,
  ConversationModelFactory,
} from '../models/conversation_model.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';

export class MongooseConversationRepository implements ConversationRepositoryInterface {
  private static readonly conv_factory = new ConversationModelFactory();
  private static readonly msg_factory = new ConversationMessageModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly conv_model: Model<Conversation>,
    private readonly msg_model: Model<ConversationMessage>
  ) {}

  static async create(): Promise<MongooseConversationRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const db = DbNameResolver.resolve('agent');
    const conn = await mgr.getDbConnection({ db });
    const conv_model = MongooseConversationRepository.conv_factory.getModel(conn);
    const msg_model = MongooseConversationRepository.msg_factory.getModel(conn);
    return new MongooseConversationRepository(conn, conv_model, msg_model);
  }

  async createConversation(params: {
    conversation_id: string;
    user_id?: string;
    agent_id: string;
    title?: string;
  }): Promise<Conversation> {
    const created = await this.conv_model.create(params);
    return MongooseUtils.toDomain<Conversation>(created);
  }

  async getConversation(conversation_id: string): Promise<Conversation | null> {
    const doc = await this.conv_model.findOne({ conversation_id }).lean();
    return doc ? (MongooseUtils.toDomain<Conversation>(doc) as Conversation) : null;
  }

  async listConversationsForUser(params: ListConversationsForUserParams): Promise<Conversation[]> {
    const filter: Record<string, unknown> = { user_id: params.user_id };
    if (params.before_updated_at) {
      filter.updated_at = { $lt: params.before_updated_at };
    }
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const docs = await this.conv_model
      .find(filter)
      .sort({ updated_at: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => MongooseUtils.toDomain<Conversation>(d));
  }

  async setLastProviderResponseId(
    conversation_id: string,
    last_provider_response_id: string
  ): Promise<void> {
    await this.conv_model.updateOne(
      { conversation_id },
      { $set: { last_provider_response_id } }
    );
  }

  async appendMessages(messages: Omit<ConversationMessage, 'created_at'>[]): Promise<void> {
    if (!messages.length) return;
    await this.msg_model.insertMany(messages, { ordered: true });
  }

  async listMessages(conversation_id: string): Promise<ConversationMessage[]> {
    const docs = await this.msg_model
      .find({ conversation_id })
      .sort({ turn: 1, created_at: 1 })
      .lean();
    return docs.map((d) => MongooseUtils.toDomain<ConversationMessage>(d));
  }

  async nextTurn(conversation_id: string): Promise<number> {
    const last = await this.msg_model
      .findOne({ conversation_id })
      .sort({ turn: -1 })
      .select({ turn: 1 })
      .lean();
    return ((last?.turn as number | undefined) ?? 0) + 1;
  }
}
