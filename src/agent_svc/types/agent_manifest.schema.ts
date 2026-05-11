import { z } from 'zod';
import { AgentEngine, type AgentOutputSchema } from './agent.types.js';
import { JsonSchemaValidator } from '../../lib/json_schema_validator.js';

const output_schema_zod = z.custom<AgentOutputSchema>(
  (value) => JsonSchemaValidator.isValidJsonSchema(value),
  { message: 'Invalid JSON Schema' }
);

export const agent_manifest_schema = z.object({
  agent_id: z.string().min(1),
  name: z.string().min(1),
  instructions: z.string().min(1),
  model: z.string().optional(),
  engine: z.nativeEnum(AgentEngine),
  tool_names: z.array(z.string()).default([]),
  tool_agent_ids: z.array(z.string()).default([]),
  handoff_agent_ids: z.array(z.string()).default([]),
  mcp_server_ids: z.array(z.string()).default([]),
  output_schema: output_schema_zod.optional(),
  enabled: z.boolean().default(true),
  version: z.number().int().min(1).default(1),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const agent_manifest_create_input_schema = agent_manifest_schema
  .omit({ created_at: true, updated_at: true, version: true, agent_id: true, engine: true })
  .extend({
    agent_id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    instructions: z.string().trim().min(1),
    engine: z.nativeEnum(AgentEngine).default(AgentEngine.OpenAi),
  })
  .strict();

export const agent_manifest_update_input_schema = agent_manifest_schema
  .pick({
    name: true,
    instructions: true,
    model: true,
    engine: true,
    tool_names: true,
    tool_agent_ids: true,
    handoff_agent_ids: true,
    mcp_server_ids: true,
    enabled: true,
  })
  .partial()
  .extend({
    name: z.string().trim().min(1).optional(),
    instructions: z.string().trim().min(1).optional(),
    output_schema: z.union([output_schema_zod, z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });
