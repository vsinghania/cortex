import type { AgentSessionMessage, AppendMessagesInput, SessionMessage, SessionMessageListParams } from '../types/session_message.types.js';

export type SessionMessageListResult = {
  items: AgentSessionMessage[];
  total?: number; // optional to avoid extra count when not needed
};

export interface SessionMessageRepository {
  appendMessages(input: AppendMessagesInput): Promise<number>; // returns inserted count

  listMessages(params: SessionMessageListParams): Promise<SessionMessageListResult>;

  getMessageById(params: {
    user_id: string;
    session_id: string;
    message_id: string;
  }): Promise<AgentSessionMessage | null>;

  deleteMessages(params: {
    user_id: string;
    session_id: string;
    before?: Date;
    after?: Date;
  }): Promise<number>; // returns deleted count
}
