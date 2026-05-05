import type { AgentUsage } from './agent.types.js';
import type { Message } from './message.types.js';

export type Conversation = {
  conversation_id: string;
  user_id?: string;
  agent_id: string;
  title?: string;
  last_provider_response_id?: string;
  created_at: Date;
  updated_at: Date;
};

export type ConversationMessageMeta = {
  conversation_id: string;
  turn: number;
  created_at: Date;
  usage?: AgentUsage;
  model?: string;
};

export type ConversationMessage = Message & ConversationMessageMeta;

export type AppendTurnInput = {
  conversation_id: string;
  user_id?: string;
  agent_id: string;
  messages: Message[];
  usage: AgentUsage;
  model?: string;
};
