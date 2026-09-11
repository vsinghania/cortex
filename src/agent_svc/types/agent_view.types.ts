import type { AgentManifest } from './agent.types.js';
import type { McpServerMode } from './mcp_server.types.js';

export enum AgentLoadStatus {
  Loaded = 'loaded',
  Disabled = 'disabled',
  /** Enabled but absent from the registry: failed to build/compile, or not yet refreshed. */
  NotLoaded = 'not_loaded',
}

/** What the registry is actually serving for an agent, as opposed to what is stored. */
export type AgentRuntimeView = {
  model: string;
  /** Effective prompt: manifest instructions plus composed instruction policies. */
  instructions: string;
  compiled: boolean;
  manifest_version: number;
  manifest_updated_at: Date;
  tool_names: string[];
  mcp_servers: { mcp_server_id: string; mode: McpServerMode }[];
  tool_agent_ids: string[];
  handoff_agent_ids: string[];
};

export type AgentView = {
  manifest: AgentManifest;
  status: AgentLoadStatus;
  runtime: AgentRuntimeView | null;
};
