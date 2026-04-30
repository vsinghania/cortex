import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
}
