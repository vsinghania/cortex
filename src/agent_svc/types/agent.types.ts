import type { AnyZodObject } from 'zod';
import type { Logger } from 'pino';
import type { JsonSchemaDefinition } from '@openai/agents';
import type { Message } from './message.types.js';
import type { CitationView } from '../../citation_svc/types/citation.types.js';

export type AgentOutputSchema = JsonSchemaDefinition['schema'];

export enum AgentEngine {
  OpenAi = 'openai',
}

export type AgentManifest = {
  agent_id: string;
  name: string;
  instructions: string;
  model?: string;
  engine: AgentEngine;
  tool_names: string[];
  tool_agent_ids: string[];
  handoff_agent_ids: string[];
  mcp_server_ids: string[];
  instruction_policy_names: string[];
  output_schema?: AgentOutputSchema;
  enabled: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};

export type AgentUpdatePatch = Partial<
  Pick<
    AgentManifest,
    | 'name'
    | 'instructions'
    | 'model'
    | 'engine'
    | 'tool_names'
    | 'tool_agent_ids'
    | 'handoff_agent_ids'
    | 'mcp_server_ids'
    | 'instruction_policy_names'
    | 'enabled'
  >
> & {
  output_schema?: AgentOutputSchema | null;
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
  input: string | Message[];
  message_history?: Message[];
  conversation_id?: string;
  user_id?: string;
  previous_response_id?: string;
  context?: Record<string, unknown>;
  options?: AgentRunOptions;
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
  message_history: Message[];
  usage: AgentUsage;
  model?: string;
  conversation_id?: string;
  stop_reason: AgentStopReason;
  /** Citations from final_output_text, already joined with live document data. */
  citations?: CitationView[];
};
