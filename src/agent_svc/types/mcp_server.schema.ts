import { z } from 'zod';
import { McpServerMode, McpTransport } from './mcp_server.types.js';

export const mcp_http_config_schema = z.object({
  base_url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth_token_env: z.string().min(1).optional(),
});

export const mcp_server_manifest_schema = z.object({
  mcp_server_id: z.string().min(1),
  name: z.string().min(1),
  mode: z.nativeEnum(McpServerMode),
  transport: z.nativeEnum(McpTransport),
  http: mcp_http_config_schema,
  enabled: z.boolean().default(true),
  version: z.number().int().min(1).default(1),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const mcp_server_manifest_create_input_schema = mcp_server_manifest_schema
  .omit({ created_at: true, updated_at: true, version: true })
  .extend({
    version: z.number().int().min(1).default(1),
  });
