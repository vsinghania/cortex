import { z } from "zod";
import { mcp_config_schema } from "../../mcp/client/types/mcp_config.types.js";

/**
 * Zod schemas for agent factory configuration (untrusted boundary).
 * Use these to validate config loaded from files/env before constructing agents.
 */

export const agent_provider_schema = z.enum(["openai"]).default("openai");

export const agent_run_options_schema = z.object({
  max_steps: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  metadata: z.record(z.unknown()).optional(),
  timeout_ms: z.number().int().positive().optional()
});

export const agent_config_schema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
  user_id: z.string().min(1).optional(),
  provider: agent_provider_schema.optional().default("openai"),
  default_model: z.string().optional(),
  tools: z.array(z.string()).optional().default([]),
  mcp_configs: z.array(mcp_config_schema).optional().default([]),
  tool_agents: z.array(z.string()).optional().default([]),
  handoff_agents: z.array(z.string()).optional().default([]),
  default_run_options: agent_run_options_schema.optional()
});

export type AgentProviderName = z.infer<typeof agent_provider_schema>;
export type AgentRunOptionsConfig = z.infer<typeof agent_run_options_schema>;
export type AgentConfig = z.infer<typeof agent_config_schema>;
