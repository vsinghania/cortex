export type SessionRole = 'user' | 'model' | 'tool' | 'mcp';
export type ModelResponseType = 'output' | 'tool_call' | 'mcp_call' | 'human_approval';

export type AgentContext = {
  agent_id?: string;
  agent_name?: string;
  provider?: string; // e.g., 'openai' | 'vertex' | 'bedrock' | 'anthropic' | 'ollama' | 'other'
  model?: string;    // model identifier, e.g., 'gpt-4o'
  provider_session_id?: string;
};

export type ToolCallDetails = {
  tool_name: string;
  arguments?: Record<string, unknown>;
};

export type McpDetails = {
  server_name: string;
  tool_name: string;
  arguments?: Record<string, unknown>;
  resource_uri?: string;
};

export type MessageContent = {
  data: unknown;
  data_type: 'json' | 'string';
  tool_details?: ToolCallDetails;
  mcp_details?: McpDetails;
};

export type SessionMessage = {
  message_id: string;
  sender: { name: string; role: SessionRole };
  agent_context?: AgentContext;
  model_response_type: ModelResponseType;
  content: MessageContent;
  timestamp: Date;
  provider_response_id?: string;
};

export interface AgentSessionMessage extends SessionMessage {
  user_id: string;
  session_id: string;
}

export type AppendMessagesInput = {
  user_id: string;
  session_id: string;
  messages: Array<Partial<SessionMessage> & { sender: { name: string; role: SessionRole }; content: MessageContent; model_response_type: ModelResponseType }>;
};

export type SessionMessageListParams = {
  user_id: string;
  session_id: string;
  limit?: number;            // default 50, clamp [1..200]
  offset?: number;           // default 0
  order?: 'asc' | 'desc';    // default 'asc'
};
