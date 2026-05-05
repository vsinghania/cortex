import type {
  AgentManifest,
  AgentUpdatePatch,
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

export type CreateAgentInput = {
  agent_id?: string;
  name: string;
  instructions: string;
  model?: string;
  engine?: AgentManifest['engine'];
  tool_names?: string[];
  tool_agent_ids?: string[];
  handoff_agent_ids?: string[];
  mcp_server_ids?: string[];
  enabled?: boolean;
};

export type UpdateAgentInput = {
  agent_id: string;
  patch: AgentUpdatePatch;
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
  createAgent(input: CreateAgentInput): Promise<AgentManifest>;
  updateAgent(input: UpdateAgentInput): Promise<AgentManifest>;
  runByAgentId(input: RunByAgentIdInput): Promise<AgentRunResponse>;
  runAdHoc(input: RunAdHocInput): Promise<AgentRunResponse>;
  listConversations(input: ListConversationsInput): Promise<Conversation[]>;
  getConversation(input: GetConversationInput): Promise<ConversationWithMessages>;
}
