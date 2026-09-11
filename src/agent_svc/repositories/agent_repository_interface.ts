import type { AgentManifest } from '../types/agent.types.js';
import type { AgentUpdatePatch } from '../types/agent.types.js';

export interface AgentRepositoryInterface {
  listEnabled(): Promise<AgentManifest[]>;
  listAll(): Promise<AgentManifest[]>;
  getById(agent_id: string): Promise<AgentManifest | null>;
  create(manifest: Omit<AgentManifest, 'created_at' | 'updated_at'>): Promise<AgentManifest>;
  updateByAgentId(agent_id: string, patch: AgentUpdatePatch): Promise<AgentManifest | null>;
  upsertByAgentId(manifest: Omit<AgentManifest, 'created_at' | 'updated_at'>): Promise<AgentManifest>;
  setEnabled(agent_id: string, enabled: boolean): Promise<AgentManifest | null>;
  deleteByAgentId(agent_id: string): Promise<boolean>;
}
