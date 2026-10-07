import { Role, type Message } from '../types/message.types.js';
import type { ConversationRepositoryInterface } from './conversation_repository_interface.js';
import { MongooseConversationRepository } from './mongoose_conversation_repository.js';
import { logger } from '../../common/logger.js';
import { Id } from '../../lib/id.js';
import type {
  AppendTurnInput,
  ContextRef,
  Conversation,
  ConversationMessage,
  ConversationPatch,
} from '../types/conversation.types.js';

export class ConversationStore {
  private static instance: ConversationStore | null = null;
  private static in_flight: Promise<ConversationStore> | null = null;

  private constructor(private readonly repo: ConversationRepositoryInterface) {}

  static async getInstance(): Promise<ConversationStore> {
    if (ConversationStore.instance) return ConversationStore.instance;
    if (ConversationStore.in_flight) return ConversationStore.in_flight;

    ConversationStore.in_flight = ConversationStore.loadInstance();
    return ConversationStore.in_flight;
  }

  private static async loadInstance(): Promise<ConversationStore> {
    try {
      const repo = await MongooseConversationRepository.create();
      const inst = new ConversationStore(repo);
      ConversationStore.instance = inst;
      logger.info('ConversationStore initialized');
      return inst;
    } finally {
      ConversationStore.in_flight = null;
    }
  }

  async ensureConversation(params: {
    conversation_id?: string;
    user_id?: string;
    agent_id: string;
    context_ref?: ContextRef;
  }): Promise<{ conversation: Conversation; created: boolean }> {
    if (params.conversation_id) {
      const existing = await this.repo.getConversation(params.conversation_id);
      if (existing) {
        logger.debug({ conversation_id: existing.conversation_id }, 'Conversation reused');
        return { conversation: existing, created: false };
      }
    }
    const conversation_id = params.conversation_id ?? Id.generateUuidV7();
    const conversation = await this.repo.createConversation({
      conversation_id,
      user_id: params.user_id,
      agent_id: params.agent_id,
      context_ref: params.context_ref,
    });
    logger.info(
      {
        conversation_id: conversation.conversation_id,
        user_id: params.user_id,
        agent_id: params.agent_id,
        context_corpus: params.context_ref?.corpus,
      },
      'Conversation created'
    );
    return { conversation, created: true };
  }

  async setTitleIfUnset(conversation_id: string, title: string): Promise<boolean> {
    return this.repo.setTitleIfUnset(conversation_id, title);
  }

  async loadHistory(conversation_id: string): Promise<Message[]> {
    const messages = await this.repo.listMessages(conversation_id);
    return messages
      .filter((m) => m.role !== Role.System)
      .map((m) => ConversationStore.toMessage(m));
  }

  async listForUser(params: {
    user_id: string;
    limit?: number;
    before_updated_at?: Date;
    pinned?: boolean;
    context_ref?: ContextRef;
  }): Promise<Conversation[]> {
    return this.repo.listConversationsForUser(params);
  }

  async updateForUser(params: {
    conversation_id: string;
    user_id: string;
    patch: ConversationPatch;
  }): Promise<Conversation | null> {
    return this.repo.updateForUser(params);
  }

  async getForUser(params: {
    conversation_id: string;
    user_id: string;
  }): Promise<Conversation | null> {
    const conv = await this.repo.getConversation(params.conversation_id);
    if (!conv) return null;
    if (conv.user_id !== params.user_id) return null;
    return conv;
  }

  async listMessages(conversation_id: string): Promise<ConversationMessage[]> {
    return this.repo.listMessages(conversation_id);
  }

  async deleteForUser(params: {
    conversation_id: string;
    user_id: string;
  }): Promise<{ message_count: number } | null> {
    const conv = await this.getForUser(params);
    if (!conv) return null;
    return this.repo.deleteConversation(conv.conversation_id);
  }

  async appendTurn(input: AppendTurnInput): Promise<void> {
    if (!input.messages.length) return;
    const start_turn = await this.repo.nextTurn(input.conversation_id);
    const last_index = input.messages.length - 1;

    const docs = input.messages.map((msg, i) => {
      const base: Omit<ConversationMessage, 'created_at'> = {
        ...msg,
        conversation_id: input.conversation_id,
        turn: start_turn + i,
      };
      if (i === last_index) {
        base.usage = input.usage;
        base.model = input.model;
      }
      return base;
    });

    await this.repo.appendMessages(docs);

    const last_provider_response_id = ConversationStore.findLastProviderResponseId(input.messages);
    if (last_provider_response_id) {
      await this.repo.setLastProviderResponseId(input.conversation_id, last_provider_response_id);
    }
    logger.info(
      {
        conversation_id: input.conversation_id,
        turn_start: start_turn,
        message_count: input.messages.length,
        model: input.model,
      },
      'Conversation turn appended'
    );
  }

  private static findLastProviderResponseId(messages: Message[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === Role.Assistant && m.provider_response_id) {
        return m.provider_response_id;
      }
    }
    return undefined;
  }

  private static toMessage(m: ConversationMessage): Message {
    switch (m.role) {
      case Role.System:
        return { role: Role.System, content: m.content };
      case Role.User:
        return { role: Role.User, content: m.content };
      case Role.Assistant:
        return {
          role: Role.Assistant,
          content: m.content,
          tool_calls: m.tool_calls,
          provider_response_id: m.provider_response_id,
          citations: m.citations,
        };
      case Role.Tool:
        return {
          role: Role.Tool,
          tool_call_id: m.tool_call_id,
          content: m.content,
        };
    }
  }
}
