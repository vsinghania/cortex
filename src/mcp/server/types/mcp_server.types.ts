import type { Server } from 'node:http';
import type { ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';

export interface McpHttpConfig {
  host: string;
  port: number;
  path: string;
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
