import type {
  AgentManifest,
  AgentRunOptions,
  AgentRunRequest,
  AgentRunResponse,
  Tool,
} from './types/agent.types.js';
import type { Message } from './types/message.types.js';
import type {
  Conversation,
  ConversationMessage,
} from './types/conversation.types.js';

export type RunByAgentIdInput = {
  agent_id: string;
  input: string | Message[];
  conversation_id?: string;
  user_id?: string;
  options?: AgentRunOptions;
};

export type RunAdHocInput = {
  manifest: AgentManifest;
  tools: Tool[];
  request: AgentRunRequest;
};

export type ListConversationsInput = {
  user_id: string;
  limit?: number;
  before_updated_at?: Date;
};

export type GetConversationInput = {
  conversation_id: string;
  user_id: string;
};

export type ConversationWithMessages = {
  conversation: Conversation;
  messages: ConversationMessage[];
};

export interface AgentSvcInterface {
  runByAgentId(input: RunByAgentIdInput): Promise<AgentRunResponse>;
  runAdHoc(input: RunAdHocInput): Promise<AgentRunResponse>;
  listConversations(input: ListConversationsInput): Promise<Conversation[]>;
  getConversation(input: GetConversationInput): Promise<ConversationWithMessages>;
}
