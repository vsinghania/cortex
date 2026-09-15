import type { ContextRef, Conversation, ConversationMessage } from '../types/conversation.types.js';

export type ListConversationsForUserParams = {
  user_id: string;
  limit?: number;
  before_updated_at?: Date;
  /** Omit for every conversation; `false` also matches conversations from before pinning existed. */
  pinned?: boolean;
  /** Only conversations anchored to this document. */
  context_ref?: ContextRef;
};

export interface ConversationRepositoryInterface {
  createConversation(params: {
    conversation_id: string;
    user_id?: string;
    agent_id: string;
    context_ref?: ContextRef;
    title?: string;
  }): Promise<Conversation>;

  getConversation(conversation_id: string): Promise<Conversation | null>;

  listConversationsForUser(params: ListConversationsForUserParams): Promise<Conversation[]>;

  setLastProviderResponseId(conversation_id: string, last_provider_response_id: string): Promise<void>;

  setTitle(conversation_id: string, title: string): Promise<void>;

  /** Leaves `updated_at` alone, since the conversation list is ordered by it. */
  setPinned(params: { conversation_id: string; user_id: string; is_pinned: boolean }): Promise<Conversation | null>;

  appendMessages(messages: Omit<ConversationMessage, 'created_at'>[]): Promise<void>;

  listMessages(conversation_id: string): Promise<ConversationMessage[]>;

  nextTurn(conversation_id: string): Promise<number>;

  /** Snapshots the conversation and its messages to trash, then deletes them. */
  deleteConversation(conversation_id: string): Promise<{ message_count: number }>;
}
