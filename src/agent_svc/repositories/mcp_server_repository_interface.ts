import type { McpServerManifest } from '../types/mcp_server.types.js';

export interface McpServerRepositoryInterface {
  listEnabled(): Promise<McpServerManifest[]>;
  getById(mcp_server_id: string): Promise<McpServerManifest | null>;
  upsertByMcpServerId(
    manifest: Omit<McpServerManifest, 'created_at' | 'updated_at'>
  ): Promise<McpServerManifest>;
  setEnabled(mcp_server_id: string, enabled: boolean): Promise<McpServerManifest | null>;
  deleteByMcpServerId(mcp_server_id: string): Promise<boolean>;
}
