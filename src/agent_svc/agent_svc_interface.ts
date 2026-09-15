import type {
  AgentManifest,
  AgentOutputSchema,
  AgentUpdatePatch,
  AgentRunOptions,
  AgentRunRequest,
  AgentRunResponse,
  Tool,
} from './types/agent.types.js';
import type { Message } from './types/message.types.js';
import type { AgentView } from './types/agent_view.types.js';
import type {
  Conversation,
  ConversationMessageView,
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
  instruction_policy_names?: string[];
  output_schema?: AgentOutputSchema;
  enabled?: boolean;
};

export type UpdateAgentInput = {
  agent_id: string;
  patch: AgentUpdatePatch;
};

export type GetAgentInput = {
  agent_id: string;
};

export type ListConversationsInput = {
  user_id: string;
  limit?: number;
  before_updated_at?: Date;
  pinned?: boolean;
};

export type SetConversationPinnedInput = {
  conversation_id: string;
  user_id: string;
  is_pinned: boolean;
};

export type GetConversationInput = {
  conversation_id: string;
  user_id: string;
};

export type DeleteConversationInput = {
  conversation_id: string;
  user_id: string;
};

export type ConversationWithMessages = {
  conversation: Conversation;
  messages: ConversationMessageView[];
};

export interface AgentSvcInterface {
  createAgent(input: CreateAgentInput): Promise<AgentManifest>;
  updateAgent(input: UpdateAgentInput): Promise<AgentManifest>;
  listAgents(): Promise<AgentView[]>;
  getAgent(input: GetAgentInput): Promise<AgentView>;
  runByAgentId(input: RunByAgentIdInput): Promise<AgentRunResponse>;
  runAdHoc(input: RunAdHocInput): Promise<AgentRunResponse>;
  listConversations(input: ListConversationsInput): Promise<Conversation[]>;
  getConversation(input: GetConversationInput): Promise<ConversationWithMessages>;
  deleteConversation(input: DeleteConversationInput): Promise<void>;
  setConversationPinned(input: SetConversationPinnedInput): Promise<Conversation>;
}
