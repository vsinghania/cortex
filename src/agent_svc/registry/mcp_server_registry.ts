import { MCPServerStreamableHttp, hostedMcpTool } from '@openai/agents';
import type { McpServerManifest } from '../types/mcp_server.types.js';
import { McpServerMode } from '../types/mcp_server.types.js';
import type { McpServerRepositoryInterface } from '../repositories/mcp_server_repository_interface.js';
import { MongooseMcpServerRepository } from '../repositories/mongoose_mcp_server_repository.js';
import { logger } from '../../common/logger.js';

export type SelfHostedHandle = {
  id: string;
  mode: McpServerMode.SelfHosted;
  sdk_server: MCPServerStreamableHttp;
};

export type PublicHostedHandle = {
  id: string;
  mode: McpServerMode.PublicHosted;
  sdk_tool: ReturnType<typeof hostedMcpTool>;
};

export type McpServerHandle = SelfHostedHandle | PublicHostedHandle;

export class McpServerRegistry {
  private static instance: McpServerRegistry | null = null;
  private static in_flight: Promise<McpServerRegistry> | null = null;

  private handles = new Map<string, McpServerHandle>();

  private constructor(private readonly repo: McpServerRepositoryInterface) {}

  static async getInstance(): Promise<McpServerRegistry> {
    if (McpServerRegistry.instance) return McpServerRegistry.instance;
    if (McpServerRegistry.in_flight) return McpServerRegistry.in_flight;

    McpServerRegistry.in_flight = McpServerRegistry.bootstrap()
      .then((inst) => {
        McpServerRegistry.instance = inst;
        return inst;
      })
      .finally(() => {
        McpServerRegistry.in_flight = null;
      });

    return McpServerRegistry.in_flight;
  }

  static getExistingInstance(): McpServerRegistry | null {
    return McpServerRegistry.instance;
  }

  private static async bootstrap(): Promise<McpServerRegistry> {
    const repo = await MongooseMcpServerRepository.create();
    const registry = new McpServerRegistry(repo);
    await registry.refresh();
    return registry;
  }

  async refresh(): Promise<void> {
    const manifests = await this.repo.listEnabled();
    const next = new Map<string, McpServerHandle>();

    for (const manifest of manifests) {
      try {
        const handle = await this.buildHandle(manifest);
        if (handle) next.set(manifest.mcp_server_id, handle);
      } catch (err) {
        logger.warn(
          { mcp_server_id: manifest.mcp_server_id, err },
          'Skipping MCP server: failed to initialize'
        );
      }
    }

    await this.closeAll();
    this.handles = next;
    logger.info({ count: this.handles.size }, 'McpServerRegistry loaded');
  }

  resolveAll(ids: string[]): McpServerHandle[] {
    const out: McpServerHandle[] = [];
    for (const id of ids) {
      const handle = this.handles.get(id);
      if (!handle) {
        logger.warn({ mcp_server_id: id }, 'Unresolved MCP server reference; skipping');
        continue;
      }
      out.push(handle);
    }
    return out;
  }

  list(): McpServerHandle[] {
    return Array.from(this.handles.values());
  }

  async closeAll(): Promise<void> {
    for (const handle of this.handles.values()) {
      if (handle.mode !== McpServerMode.SelfHosted) continue;
      try {
        await handle.sdk_server.close();
      } catch (err) {
        logger.warn(
          { mcp_server_id: handle.id, err },
          'Failed to close MCP server connection'
        );
      }
    }
  }

  private async buildHandle(
    manifest: McpServerManifest
  ): Promise<McpServerHandle | null> {
    const auth_token = this.resolveAuthToken(manifest);
    const headers = this.buildHeaders(manifest, auth_token);

    if (manifest.mode === McpServerMode.SelfHosted) {
      const server = new MCPServerStreamableHttp({
        name: manifest.name,
        url: manifest.http.base_url,
        requestInit: headers ? { headers } : undefined,
      });
      await server.connect();
      logger.info(
        { mcp_server_id: manifest.mcp_server_id, url: manifest.http.base_url },
        'Connected to self-hosted MCP server'
      );
      return {
        id: manifest.mcp_server_id,
        mode: McpServerMode.SelfHosted,
        sdk_server: server,
      };
    }

    if (manifest.mode === McpServerMode.PublicHosted) {
      const tool = hostedMcpTool({
        serverLabel: manifest.mcp_server_id,
        serverUrl: manifest.http.base_url,
        headers,
      });
      logger.info(
        { mcp_server_id: manifest.mcp_server_id, url: manifest.http.base_url },
        'Registered public-hosted MCP server'
      );
      return {
        id: manifest.mcp_server_id,
        mode: McpServerMode.PublicHosted,
        sdk_tool: tool,
      };
    }

    return null;
  }

  private resolveAuthToken(manifest: McpServerManifest): string | undefined {
    const env_name = manifest.http.auth_token_env;
    if (!env_name) return undefined;
    const value = process.env[env_name];
    if (!value || value.length === 0) {
      throw new Error(
        `Missing env var ${env_name} for MCP server ${manifest.mcp_server_id}`
      );
    }
    return value;
  }

  private buildHeaders(
    manifest: McpServerManifest,
    auth_token: string | undefined
  ): Record<string, string> | undefined {
    const headers: Record<string, string> = { ...(manifest.http.headers ?? {}) };
    if (auth_token) headers.Authorization = `Bearer ${auth_token}`;
    return Object.keys(headers).length > 0 ? headers : undefined;
  }
}
