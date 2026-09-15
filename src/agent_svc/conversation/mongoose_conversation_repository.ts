import type { Connection, Model } from 'mongoose';
import type { ContextRef, Conversation, ConversationMessage } from '../types/conversation.types.js';
import type {
  ConversationRepositoryInterface,
  ListConversationsForUserParams,
} from './conversation_repository_interface.js';
import {
  ConversationMessageModelFactory,
  ConversationModelFactory,
} from '../models/conversation_model.js';
import {
  ConversationMessageTrashModelFactory,
  ConversationTrashModelFactory,
} from '../models/conversation_trash_model.js';
import type {
  TrashedConversation,
  TrashedConversationMessage,
} from '../types/conversation_trash.types.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';

export class MongooseConversationRepository implements ConversationRepositoryInterface {
  private static readonly conv_factory = new ConversationModelFactory();
  private static readonly msg_factory = new ConversationMessageModelFactory();
  private static readonly conv_trash_factory = new ConversationTrashModelFactory();
  private static readonly msg_trash_factory = new ConversationMessageTrashModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly conv_model: Model<Conversation>,
    private readonly msg_model: Model<ConversationMessage>,
    private readonly conv_trash_model: Model<TrashedConversation>,
    private readonly msg_trash_model: Model<TrashedConversationMessage>
  ) {}

  static async create(): Promise<MongooseConversationRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const db = DbNameResolver.resolve('agent');
    const conn = await mgr.getDbConnection({ db });
    const conv_model = MongooseConversationRepository.conv_factory.getModel(conn);
    const msg_model = MongooseConversationRepository.msg_factory.getModel(conn);
    const conv_trash_model = MongooseConversationRepository.conv_trash_factory.getModel(conn);
    const msg_trash_model = MongooseConversationRepository.msg_trash_factory.getModel(conn);
    return new MongooseConversationRepository(
      conn,
      conv_model,
      msg_model,
      conv_trash_model,
      msg_trash_model
    );
  }

  async createConversation(params: {
    conversation_id: string;
    user_id?: string;
    agent_id: string;
    context_ref?: ContextRef;
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
    if (params.pinned !== undefined) {
      filter.is_pinned = params.pinned ? true : { $ne: true };
    }
    if (params.context_ref) {
      filter['context_ref.corpus'] = params.context_ref.corpus;
      filter['context_ref.document_id'] = params.context_ref.document_id;
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

  async setTitle(conversation_id: string, title: string): Promise<void> {
    await this.conv_model.updateOne(
      { conversation_id },
      { $set: { title } }
    );
  }

  async setPinned(params: {
    conversation_id: string;
    user_id: string;
    is_pinned: boolean;
  }): Promise<Conversation | null> {
    const doc = await this.conv_model
      .findOneAndUpdate(
        { conversation_id: params.conversation_id, user_id: params.user_id },
        { $set: { is_pinned: params.is_pinned } },
        { new: true, timestamps: false }
      )
      .lean();
    return doc ? MongooseUtils.toDomain<Conversation>(doc) : null;
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

  /**
   * Trash writes are upserts on the live _id and messages go before the conversation, so a
   * failure part-way leaves the chat listed and a retry completes the backup without duplicates.
   */
  async deleteConversation(conversation_id: string): Promise<{ message_count: number }> {
    const message_count = await this.snapshotToTrash(conversation_id);
    await this.msg_model.deleteMany({ conversation_id });
    await this.conv_model.deleteOne({ conversation_id });
    return { message_count };
  }

  private async snapshotToTrash(conversation_id: string): Promise<number> {
    const deleted_at = new Date();
    const conversation = await this.conv_model.findOne({ conversation_id }).lean();
    const messages = await this.msg_model.find({ conversation_id }).lean();
    if (conversation) {
      await this.conv_trash_model.bulkWrite(
        MongooseConversationRepository.toTrashUpserts([conversation], deleted_at)
      );
    }
    if (messages.length) {
      await this.msg_trash_model.bulkWrite(
        MongooseConversationRepository.toTrashUpserts(messages, deleted_at)
      );
    }
    return messages.length;
  }

  private static toTrashUpserts<T extends { _id: unknown }>(docs: T[], deleted_at: Date) {
    return docs.map((doc) => ({
      replaceOne: {
        filter: { _id: doc._id },
        replacement: { ...doc, deleted_at },
        upsert: true,
      },
    }));
  }
}
