import 'dotenv/config';
import { NotesMcpModule } from './notes_mcp_module.js';
import { BaseMcpHttpServer } from '../base_mcp_http_server.js';
import { logger } from '../../../common/logger.js';
import type { McpModule } from '../mcp_module.js';
import type { McpCaller, McpHttpConfig, McpServerInfo } from '../types/mcp_server.types.js';
import { McpCallers } from '../mcp_caller.js';
import { NotesMcpInstructions } from './notes_mcp_instructions.js';
import { NotesMcpContract } from './notes_mcp_contract.js';

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
      assertion_secret: NotesMcpHttpServer.resolveAssertionSecret(),
      assertion_audience: NotesMcpContract.ASSERTION_AUDIENCE,
      allowed_hosts: NotesMcpHttpServer.resolveAllowedHosts()
    };
  }

  /** Cortex's own agents carry their own prompts; only external assistants need the guide. */
  protected override getInstructions(caller: McpCaller): string | undefined {
    if (!McpCallers.isExternal(caller)) return undefined;
    return NotesMcpInstructions.forExternal({ can_write: McpCallers.allows(caller, NotesMcpContract.WRITE) });
  }

  protected async createMcpModules(): Promise<McpModule[]> {
    return [await NotesMcpModule.create()];
  }

  /** Shared with web-server's public gateway; unset means only internal callers get in. */
  private static resolveAssertionSecret(): string | undefined {
    const secret = process.env.MCP_GATEWAY_ASSERTION_SECRET;
    if (!secret) {
      logger.warn('MCP_GATEWAY_ASSERTION_SECRET not set; requests from the public MCP gateway will be refused');
      return undefined;
    }
    return secret;
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
