import { MCPServerStreamableHttp, hostedMcpTool } from '@openai/agents';
import type { McpServerManifest } from '../types/mcp_server.types.js';
import { McpServerMode } from '../types/mcp_server.types.js';
import type { McpServerRepositoryInterface } from '../repositories/mcp_server_repository_interface.js';
import { MongooseMcpServerRepository } from '../repositories/mongoose_mcp_server_repository.js';
import { logger } from '../../common/logger.js';
import { TraceContext } from '../../common/trace_context.js';

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

type RegistryEntry = {
  handle: McpServerHandle;
  version: number;
  updated_at_ms: number;
};

/**
 * Has no refresh timer of its own: AgentRegistry drives refresh() so agents are
 * always recompiled after the handles they reference have been swapped.
 */
export class McpServerRegistry {
  private static instance: McpServerRegistry | null = null;
  private static in_flight: Promise<McpServerRegistry> | null = null;

  private entries = new Map<string, RegistryEntry>();

  private constructor(private readonly repo: McpServerRepositoryInterface) {}

  static async getInstance(): Promise<McpServerRegistry> {
    if (McpServerRegistry.instance) return McpServerRegistry.instance;
    if (McpServerRegistry.in_flight) return McpServerRegistry.in_flight;

    McpServerRegistry.in_flight = McpServerRegistry.loadMcpServerRegistryInstance();
    return McpServerRegistry.in_flight;
  }

  private static async loadMcpServerRegistryInstance(): Promise<McpServerRegistry> {
    try {
      const inst = await McpServerRegistry.bootstrapMcpServerRegistry();
      McpServerRegistry.instance = inst;
      return inst;
    } finally {
      McpServerRegistry.in_flight = null;
    }
  }

  static getExistingInstance(): McpServerRegistry | null {
    return McpServerRegistry.instance;
  }

  static async create(repo: McpServerRepositoryInterface): Promise<McpServerRegistry> {
    const registry = new McpServerRegistry(repo);
    await registry.refreshMcpServers();
    return registry;
  }

  private static async bootstrapMcpServerRegistry(): Promise<McpServerRegistry> {
    logger.info('McpServerRegistry bootstrap started');
    const registry = await McpServerRegistry.create(await MongooseMcpServerRepository.create());
    logger.info({ server_count: registry.entries.size }, 'McpServerRegistry bootstrap complete');
    return registry;
  }

  /**
   * Keeps the existing handle for every unchanged manifest so compiled agents
   * holding it stay valid. Replaced and removed handles are closed only after
   * the swap, so resolveAll() never hands out a closed connection.
   */
  async refreshMcpServers(): Promise<void> {
    const manifests = await this.repo.listEnabled();
    const next = new Map<string, RegistryEntry>();
    let reused_count = 0;

    for (const manifest of manifests) {
      const existing = this.entries.get(manifest.mcp_server_id);
      if (existing && McpServerRegistry.matchesStoredManifest(existing, manifest)) {
        next.set(manifest.mcp_server_id, existing);
        reused_count++;
        continue;
      }
      try {
        const handle = await this.createMcpServerHandle(manifest);
        if (handle) next.set(manifest.mcp_server_id, McpServerRegistry.toRegistryEntry(handle, manifest));
      } catch (err) {
        logger.warn(
          { mcp_server_id: manifest.mcp_server_id, err },
          'Skipping MCP server: failed to initialize'
        );
      }
    }

    const stale = this.findReplacedEntries(next);
    this.entries = next;
    await McpServerRegistry.closeEntryConnections(stale);
    logger.info(
      { count: next.size, reused_count, closed_count: stale.length },
      'McpServerRegistry loaded'
    );
  }

  resolveMcpServerHandles(ids: string[]): McpServerHandle[] {
    const out: McpServerHandle[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) {
        logger.warn({ mcp_server_id: id }, 'Unresolved MCP server reference; skipping');
        continue;
      }
      out.push(entry.handle);
    }
    return out;
  }

  listMcpServerHandles(): McpServerHandle[] {
    return Array.from(this.entries.values(), (entry) => entry.handle);
  }

  async closeMcpServerConnections(): Promise<void> {
    await McpServerRegistry.closeEntryConnections(Array.from(this.entries.values()));
  }

  private static matchesStoredManifest(entry: RegistryEntry, manifest: McpServerManifest): boolean {
    return (
      entry.version === manifest.version &&
      entry.updated_at_ms === manifest.updated_at.getTime()
    );
  }

  private static toRegistryEntry(handle: McpServerHandle, manifest: McpServerManifest): RegistryEntry {
    return {
      handle,
      version: manifest.version,
      updated_at_ms: manifest.updated_at.getTime(),
    };
  }

  private findReplacedEntries(next: Map<string, RegistryEntry>): RegistryEntry[] {
    return Array.from(this.entries.values()).filter(
      (entry) => next.get(entry.handle.id) !== entry
    );
  }

  private static async closeEntryConnections(entries: RegistryEntry[]): Promise<void> {
    for (const { handle } of entries) {
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

  private async createMcpServerHandle(
    manifest: McpServerManifest
  ): Promise<McpServerHandle | null> {
    const auth_token = this.resolveServerAuthToken(manifest);
    const headers = this.buildServerRequestHeaders(manifest, auth_token);

    if (manifest.mode === McpServerMode.SelfHosted) {
      const server = new MCPServerStreamableHttp({
        name: manifest.name,
        url: manifest.http.base_url,
        requestInit: headers ? { headers } : undefined,
        fetch: this.fetchWithTraceContext.bind(this),
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

  private resolveServerAuthToken(manifest: McpServerManifest): string | undefined {
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

  private async fetchWithTraceContext(
    url: string | URL,
    init?: RequestInit
  ): Promise<Response> {
    const ctx = TraceContext.get();
    if (!ctx) return fetch(url, init);
    const merged = new Headers(init?.headers);
    if (ctx.trace_id && !merged.has('x-trace-id')) {
      merged.set('x-trace-id', ctx.trace_id);
    }
    if (ctx.user_id && !merged.has('x-user-id')) {
      merged.set('x-user-id', ctx.user_id);
    }
    return fetch(url, { ...init, headers: merged });
  }

  private buildServerRequestHeaders(
    manifest: McpServerManifest,
    auth_token: string | undefined
  ): Record<string, string> | undefined {
    const headers: Record<string, string> = { ...(manifest.http.headers ?? {}) };
    if (auth_token) headers.Authorization = `Bearer ${auth_token}`;
    return Object.keys(headers).length > 0 ? headers : undefined;
  }
}
