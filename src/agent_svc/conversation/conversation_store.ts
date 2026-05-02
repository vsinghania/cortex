import { v4 as uuidv4 } from 'uuid';
import type { PromptMessage } from '../../ai_svc/types/ai_prompt.types.js';
import { Role } from '../../ai_svc/types/ai_prompt.types.js';
import type { ConversationRepositoryInterface } from './conversation_repository_interface.js';
import { MongooseConversationRepository } from './mongoose_conversation_repository.js';
import type {
  AppendTurnInput,
  Conversation,
  ConversationMessage,
} from '../types/conversation.types.js';

export class ConversationStore {
  private static instance: ConversationStore | null = null;
  private static in_flight: Promise<ConversationStore> | null = null;

  private constructor(private readonly repo: ConversationRepositoryInterface) {}

  static async getInstance(): Promise<ConversationStore> {
    if (ConversationStore.instance) return ConversationStore.instance;
    if (ConversationStore.in_flight) return ConversationStore.in_flight;

    ConversationStore.in_flight = MongooseConversationRepository.create()
      .then((repo) => {
        const inst = new ConversationStore(repo);
        ConversationStore.instance = inst;
        return inst;
      })
      .finally(() => {
        ConversationStore.in_flight = null;
      });

    return ConversationStore.in_flight;
  }

  async ensureConversation(params: {
    conversation_id?: string;
    user_id?: string;
    agent_id: string;
  }): Promise<Conversation> {
    if (params.conversation_id) {
      const existing = await this.repo.getConversation(params.conversation_id);
      if (existing) return existing;
    }
    const conversation_id = params.conversation_id ?? uuidv4();
    return this.repo.createConversation({
      conversation_id,
      user_id: params.user_id,
      agent_id: params.agent_id,
    });
  }

  async loadHistory(conversation_id: string): Promise<PromptMessage[]> {
    const messages = await this.repo.listMessages(conversation_id);
    return messages
      .filter((m) => m.role !== Role.SYSTEM)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async listForUser(params: {
    user_id: string;
    limit?: number;
    before_updated_at?: Date;
  }): Promise<Conversation[]> {
    return this.repo.listConversationsForUser(params);
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

  async appendTurn(input: AppendTurnInput): Promise<void> {
    const start_turn = await this.repo.nextTurn(input.conversation_id);
    await this.repo.appendMessages([
      {
        conversation_id: input.conversation_id,
        turn: start_turn,
        role: input.user_message.role,
        content: input.user_message.content,
      },
      {
        conversation_id: input.conversation_id,
        turn: start_turn + 1,
        role: input.assistant_message.role,
        content: input.assistant_message.content,
        tool_calls: input.tool_calls.length ? input.tool_calls : undefined,
        usage: input.usage,
        model: input.model,
        response_id: input.response_id,
      },
    ]);
    if (input.response_id) {
      await this.repo.setLastResponseId(input.conversation_id, input.response_id);
    }
  }
}
