import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { performance } from 'node:perf_hooks';
import { logger } from '../../common/logger.js';
import { Time } from '../../lib/time.js';
import { McpCallers } from './mcp_caller.js';
import type { McpToolRegistration } from './types/mcp_tool.types.js';
import type { McpCaller } from './types/mcp_server.types.js';

export abstract class McpModule {
  public async registerCapabilities(server: McpServer, caller: McpCaller): Promise<void> {
    await this.registerTools(server, caller);
    await this.registerResources(server, caller);
    await this.registerPrompts(server, caller);
  }

  public async cleanup(): Promise<void> {}

  protected async registerTools(_server: McpServer, _caller: McpCaller): Promise<void> {}

  protected async registerResources(_server: McpServer, _caller: McpCaller): Promise<void> {}

  protected async registerPrompts(_server: McpServer, _caller: McpCaller): Promise<void> {}

  /**
   * Registers a tool only when the caller's scopes cover it, so it is never listed to a
   * caller that cannot use it, and checks the scope again on every invocation, so that
   * registration is a convenience rather than the only line of defence. Every invocation
   * emits a uniform `MCP tool invoked` / `MCP tool failed` line.
   */
  protected registerTool<Args>(server: McpServer, caller: McpCaller, tool: McpToolRegistration<Args>): void {
    if (!McpCallers.isScopeAllowedForCaller(caller, tool.required_scope)) return;

    const module_name = this.constructor.name;
    const wrapped = async (args: Args): Promise<CallToolResult> => {
      const start_ms = performance.now();
      try {
        if (!McpCallers.isScopeAllowedForCaller(caller, tool.required_scope)) {
          throw new Error(`This connection does not have ${tool.required_scope} access.`);
        }
        const result = McpModule.toStructuredToolResult(await tool.handler(args));
        logger.info(
          { module: module_name, tool: tool.name, caller: caller.kind, ok: true, duration_ms: Time.elapsedMs(start_ms) },
          'MCP tool invoked'
        );
        return result;
      } catch (err) {
        logger.error(
          { module: module_name, tool: tool.name, caller: caller.kind, ok: false, err, duration_ms: Time.elapsedMs(start_ms) },
          'MCP tool failed'
        );
        throw err;
      }
    };
    server.registerTool(tool.name, tool.config, wrapped);
  }

  /** Compact text avoids spending tokens on indentation in agent runtimes. */
  private static toStructuredToolResult(result: Record<string, unknown>): CallToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result
    };
  }
}
