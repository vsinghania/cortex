import type { Request, Response } from 'express';
import type { Server } from 'node:http';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import type { NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import type { McpModule } from '../mcp_module.js';
import type { McpHttpConfig, McpServerInfo } from './mcp_server.types.js';

export type HostGuard = (req: Request, res: Response) => boolean;

export type McpHttpRuntime = {
  http_server: Server;
  http_cfg: McpHttpConfig;
  server_info: McpServerInfo;
  mcp_modules: McpModule[];
  mcp_handler: McpHttpHandler;
  node_handler: NodeMcpRequestHandler;
  host_guard?: HostGuard;
};
