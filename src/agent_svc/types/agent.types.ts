import type { AnyZodObject } from 'zod';
import type { Logger } from 'pino';
import type { PromptMessage } from '../../ai_svc/types/ai_prompt.types.js';

export enum AgentImplKind {
  OpenAiAgents = 'openai_agents',
}

export type AgentManifest = {
  agent_id: string;
  name: string;
  instructions: string;
  model?: string;
  implementation: AgentImplKind;
  tool_names: string[];
  tool_agent_ids: string[];
  handoff_agent_ids: string[];
  mcp_server_ids: string[];
  enabled: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};

export type ToolResult =
  | { kind: 'text'; text: string }
  | { kind: 'json'; data: unknown }
  | { kind: 'error'; message: string };

export type ToolContext = {
  user_id?: string;
  conversation_id?: string;
  signal?: AbortSignal;
  logger: Logger;
};

export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  input_schema: AnyZodObject;
  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult>;
}

export type AgentRunOptions = {
  max_turns?: number;
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
  retries?: number;
};

export type AgentRunRequest = {
  input: string | PromptMessage[];
  message_history?: PromptMessage[];
  conversation_id?: string;
  user_id?: string;
  previous_response_id?: string;
  context?: Record<string, unknown>;
  options?: AgentRunOptions;
};

export type ToolInvocation = {
  tool_name: string;
  arguments: unknown;
  result: ToolResult;
  duration_ms: number;
  turn: number;
};

export type AgentUsage = {
  prompt_tokens: number;
  response_tokens: number;
  total_tokens: number;
};

export type AgentStopReason = 'final' | 'max_turns' | 'error';

export type AgentRunResponse = {
  final_output_text?: string;
  final_output_json?: unknown;
  message_history: PromptMessage[];
  tool_calls: ToolInvocation[];
  usage: AgentUsage;
  model?: string;
  response_id?: string;
  conversation_id?: string;
  stop_reason: AgentStopReason;
};
