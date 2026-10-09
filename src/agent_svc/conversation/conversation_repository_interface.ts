import type {
  ContextRef,
  Conversation,
  ConversationMessage,
  ConversationPatch,
} from '../types/conversation.types.js';

export type ListConversationsForUserParams = {
  user_id: string;
  limit?: number;
  before_updated_at?: Date;
  /** Omit for every conversation; `false` also matches conversations from before pinning existed. */
  pinned?: boolean;
  /** Only conversations anchored to this document. */
  context_ref?: ContextRef;
};

/** Admin-only, and NOT user-scoped: counts for a page of users in the admin users view. */
export type ConversationUserCount = {
  user_id: string;
  count: number;
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

  /** Resolves false when the conversation already has a title, so a user's rename wins. */
  setTitleIfUnset(conversation_id: string, title: string): Promise<boolean>;

  /** Leaves `updated_at` alone, since the conversation list is ordered by it. */
  updateConversationForUser(params: {
    conversation_id: string;
    user_id: string;
    patch: ConversationPatch;
  }): Promise<Conversation | null>;

  appendMessages(messages: Omit<ConversationMessage, 'created_at'>[]): Promise<void>;

  listMessages(conversation_id: string): Promise<ConversationMessage[]>;

  allocateNextTurnNumber(conversation_id: string): Promise<number>;

  /** Snapshots the conversation and its messages to trash, then deletes them. */
  deleteConversation(conversation_id: string): Promise<{ message_count: number }>;

  /** Admin users view only - see ConversationUserCount. Users with none are omitted. */
  countConversationsByUser(user_ids: string[]): Promise<ConversationUserCount[]>;
}
