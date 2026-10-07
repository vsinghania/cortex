import type { Server } from 'node:http';
import type { ServerOptions } from '@modelcontextprotocol/server';

export interface McpHttpConfig {
  host: string;
  port: number;
  path: string;
  /** The service bearer every caller presents. */
  auth_token: string;
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
 * authentication. Every caller today holds the service bearer and acts for the user it
 * names in `X-User-Id`.
 */
export type McpCaller = { kind: 'internal'; user_id?: string };
