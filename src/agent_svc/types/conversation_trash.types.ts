import type { Conversation, ConversationMessage } from './conversation.types.js';

export type TrashedConversation = Conversation & {
  deleted_at: Date;
};

export type TrashedConversationMessage = ConversationMessage & {
  deleted_at: Date;
};
