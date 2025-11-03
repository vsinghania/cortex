import { z } from "zod";

/**
 * Zod-validated config/manifest schemas for MCP client creation.
 * Validate at untrusted boundary, then use inferred TS types internally.
 */

export const client_info_schema = z.object({
  name: z.string(),
  version: z.string(),
});

export const stdio_config_schema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  startup_timeout_ms: z.number().int().positive().optional(),
});

export const http_config_schema = z.object({
  base_url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth_token: z.string().optional(),
  startup_timeout_ms: z.number().int().positive().optional(),
});

export const mcp_config_schema = z
  .object({
    transport: z.enum(["stdio", "http"]),
    client: client_info_schema.optional(),
    stdio: stdio_config_schema.optional(),
    http: http_config_schema.optional(),
  })
  .refine(
    (cfg) => (cfg.transport === "stdio" ? !!cfg.stdio : !!cfg.http),
    { message: "Transport-specific configuration is required" }
  );

export type ClientInfo = z.infer<typeof client_info_schema>;
export type StdioConfig = z.infer<typeof stdio_config_schema>;
export type HttpConfig = z.infer<typeof http_config_schema>;
export type McpConfig = z.infer<typeof mcp_config_schema>;
