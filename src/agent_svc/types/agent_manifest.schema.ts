import { z } from 'zod';
import { AgentImplKind } from './agent.types.js';

export const agent_manifest_schema = z.object({
  agent_id: z.string().min(1),
  name: z.string().min(1),
  instructions: z.string().min(1),
  model: z.string().optional(),
  implementation: z.nativeEnum(AgentImplKind),
  tool_names: z.array(z.string()).default([]),
  tool_agent_ids: z.array(z.string()).default([]),
  handoff_agent_ids: z.array(z.string()).default([]),
  mcp_server_ids: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  version: z.number().int().min(1).default(1),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const agent_manifest_create_input_schema = agent_manifest_schema
  .omit({ created_at: true, updated_at: true, version: true })
  .extend({
    version: z.number().int().min(1).default(1),
  });
