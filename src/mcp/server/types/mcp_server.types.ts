import type { Server } from 'node:http';
import type { ServerOptions } from '@modelcontextprotocol/server';

export interface McpHttpConfig {
  host: string;
  port: number;
  path: string;
  /** The service bearer internal callers present; it alone grants full access. */
  auth_token: string;
  /** Verifies the public gateway's signed caller assertions; unset accepts none. */
  assertion_secret?: string;
  allowed_hosts?: string[];
}

export interface McpServerInfo {
  name: string;
  version: string;
  options?: ServerOptions;
  log_name: string;
}

export interface McpHttpServerHandle {
  server: Server;
  shutdown(): Promise<void>;
}

/**
 * Who is on the other end of one MCP request, as established by the server's own
 * authentication, never by a header the caller controls:
 * - `internal`: presented the service bearer (agent runs); every tool.
 * - `external`: an assistant such as ChatGPT or Claude, through the public gateway;
 *   only its grant's scopes, and the trimmed, linked view of notes.
 * - `first_party`: Cortex's own caller through the gateway (a voice session); its
 *   grant's scopes, and the full view its prompt was written for.
 */
export type McpCaller =
  | { kind: 'internal'; user_id?: string }
  | { kind: 'external' | 'first_party'; user_id: string; client_id: string; scopes: ReadonlySet<string> };

export type McpGatewayCaller = Extract<McpCaller, { kind: 'external' | 'first_party' }>;
