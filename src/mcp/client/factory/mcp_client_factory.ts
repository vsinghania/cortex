import type { McpClientInterface } from "../interfaces/mcp_client_interface.js";
import { StdioMcpClient } from "../adapters/stdio_mcp_client.js";
import { mcp_config_schema, type McpConfig } from "../types/mcp_config.types.js";

// Simple singleton registry to prevent multiple stdio spawns for the same config within a process.
const clientRegistry = new Map<string, McpClientInterface>();

function stableStringify(obj: Record<string, unknown>) {
  // Deterministic JSON stringify by sorting keys recursively
  const recurse = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(recurse);
    const entries = Object.entries(v as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b));
    return entries.reduce((acc, [k, val]) => {
      acc[k] = recurse(val);
      return acc;
    }, {} as Record<string, unknown>);
  };
  return JSON.stringify(recurse(obj));
}

function keyForConfig(cfg: McpConfig): string {
  if (cfg.transport === "stdio" && cfg.stdio) {
    const env = cfg.stdio.env
      ? Object.fromEntries(Object.entries(cfg.stdio.env).sort(([a],[b]) => a.localeCompare(b)))
      : undefined;
    const keyObj = {
      transport: "stdio",
      cmd: cfg.stdio.command,
      args: cfg.stdio.args ?? [],
      cwd: cfg.stdio.cwd ?? "",
      env: env ?? {}, 
      // Startup timeout is excluded from identity (doesn't change which server it is)
    };
    return stableStringify(keyObj);
  }
  // For other transports (future), include fields that uniquely identify the remote server
  return stableStringify({ transport: cfg.transport, raw: cfg as unknown as Record<string, unknown> });
}

/**
 * Create an MCP client from a validated config.
 * Currently supports stdio transport. HTTP will be added later.
 */
export function createMcpClient(cfg: McpConfig): McpClientInterface {
  if (cfg.transport === "stdio") {
    if (!cfg.stdio) throw new Error("stdio config is required for stdio transport");
    const key = keyForConfig(cfg);
    const existing = clientRegistry.get(key);
    if (existing) return existing;

    const client = new StdioMcpClient({ client: cfg.client, stdio: cfg.stdio });
    clientRegistry.set(key, client);
    return client;
  }

  // Placeholder for future HTTP/SSE transport
  throw new Error("HTTP transport not yet implemented");
}

/**
 * Validate untrusted config with Zod and create a client.
 * Use this only at untrusted boundaries (e.g., loading manifest from DB or env).
 */
export function createMcpClientFromUntrusted(raw: unknown): McpClientInterface {
  const cfg = mcp_config_schema.parse(raw);
  return createMcpClient(cfg);
}
