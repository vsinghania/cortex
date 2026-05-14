import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { performance } from 'node:perf_hooks';
import { logger } from '../../common/logger.js';
import { Time } from '../../lib/time.js';

export abstract class McpModule {
  public async register(server: McpServer): Promise<void> {
    await this.registerTools(server);
    await this.registerResources(server);
    await this.registerPrompts(server);
  }

  public async cleanup(): Promise<void> {}

  protected async init(): Promise<void> {}

  protected async registerTools(_server: McpServer): Promise<void> {}

  protected async registerResources(_server: McpServer): Promise<void> {}

  protected async registerPrompts(_server: McpServer): Promise<void> {}

  /**
   * Wraps server.registerTool so every invocation emits an info log with
   * tool name, ok/err status, and duration. Subclasses should prefer this
   * over calling server.registerTool directly.
   */
  protected registerTool(
    server: McpServer,
    name: string,
    config: any,
    handler: (...args: any[]) => any
  ): void {
    const module_name = this.constructor.name;
    const wrapped = async (...args: any[]) => {
      const start_ms = performance.now();
      try {
        const result = await handler(...args);
        logger.info(
          {
            module: module_name,
            tool: name,
            ok: true,
            duration_ms: Time.elapsedMs(start_ms),
          },
          'MCP tool invoked'
        );
        return result;
      } catch (err) {
        logger.error(
          {
            module: module_name,
            tool: name,
            ok: false,
            err,
            duration_ms: Time.elapsedMs(start_ms),
          },
          'MCP tool failed'
        );
        throw err;
      }
    };
    (server.registerTool as any)(name, config, wrapped);
  }
}
