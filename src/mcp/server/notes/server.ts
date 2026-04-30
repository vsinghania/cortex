import 'dotenv/config';
import { NotesMcpModule } from './notes_mcp_module.js';
import { BaseMcpHttpServer } from '../base_mcp_http_server.js';
import { logger } from '../../../common/logger.js';
import type { McpModule } from '../mcp_module.js';
import type { McpHttpConfig, McpServerInfo } from '../types/mcp_server.types.js';

export class NotesMcpHttpServer extends BaseMcpHttpServer {
  protected getServerInfo(): McpServerInfo {
    return {
      name: 'cortex-notes-mcp',
      version: '1.0.0',
      log_name: 'notes_mcp',
      options: {
        debouncedNotificationMethods: [
          'notifications/tools/list_changed',
          'notifications/resources/list_changed',
          'notifications/prompts/list_changed'
        ]
      }
    };
  }

  protected getHttpConfig(): McpHttpConfig {
    const auth_token = process.env.MCP_NOTES_AUTH_TOKEN;
    if (!auth_token) {
      throw new Error('MCP_NOTES_AUTH_TOKEN is required to start the notes MCP HTTP server.');
    }

    return {
      host: process.env.MCP_NOTES_HOST ?? '127.0.0.1',
      port: Number(process.env.MCP_NOTES_PORT ?? 3010) || 3010,
      path: process.env.MCP_NOTES_PATH ?? '/mcp',
      auth_token,
      allowed_hosts: NotesMcpHttpServer.resolveAllowedHosts()
    };
  }

  protected async createMcpModules(): Promise<McpModule[]> {
    return [await NotesMcpModule.create()];
  }

  private static resolveAllowedHosts(): string[] | undefined {
    const raw_allowed_hosts = process.env.MCP_NOTES_ALLOWED_HOSTS;
    if (!raw_allowed_hosts) {
      return undefined;
    }

    const allowed_hosts = raw_allowed_hosts
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);

    return allowed_hosts.length > 0 ? allowed_hosts : undefined;
  }
}

new NotesMcpHttpServer().start().catch((error: unknown) => {
  logger.error({ err: error }, 'notes_mcp_server_start_failed');
  process.exit(1);
});
