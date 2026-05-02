import type { PromptMessage } from '../../ai_svc/types/ai_prompt.types.js';
import type { AgentUsage, ToolInvocation } from './agent.types.js';

export type Conversation = {
  conversation_id: string;
  user_id?: string;
  agent_id: string;
  title?: string;
  last_response_id?: string;
  created_at: Date;
  updated_at: Date;
};

export type ConversationMessage = {
  conversation_id: string;
  turn: number;
  role: PromptMessage['role'];
  content: string;
  tool_calls?: ToolInvocation[];
  usage?: AgentUsage;
  model?: string;
  response_id?: string;
  created_at: Date;
};

export type AppendTurnInput = {
  conversation_id: string;
  user_id?: string;
  agent_id: string;
  user_message: PromptMessage;
  assistant_message: PromptMessage;
  tool_calls: ToolInvocation[];
  usage: AgentUsage;
  model?: string;
  response_id?: string;
};
