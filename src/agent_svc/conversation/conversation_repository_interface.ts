import type { Conversation, ConversationMessage } from '../types/conversation.types.js';

export type ListConversationsForUserParams = {
  user_id: string;
  limit?: number;
  before_updated_at?: Date;
};

export interface ConversationRepositoryInterface {
  createConversation(params: {
    conversation_id: string;
    user_id?: string;
    agent_id: string;
    title?: string;
  }): Promise<Conversation>;

  getConversation(conversation_id: string): Promise<Conversation | null>;

  listConversationsForUser(params: ListConversationsForUserParams): Promise<Conversation[]>;

  setLastResponseId(conversation_id: string, last_response_id: string): Promise<void>;

  appendMessages(messages: Omit<ConversationMessage, 'created_at'>[]): Promise<void>;

  listMessages(conversation_id: string): Promise<ConversationMessage[]>;

  nextTurn(conversation_id: string): Promise<number>;
}
