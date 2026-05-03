import type { AgentManifest, Tool } from '../types/agent.types.js';
import { AgentEngine } from '../types/agent.types.js';
import type { McpServerHandle } from '../registry/mcp_server_registry.js';
import { BaseAgent } from '../agents/base_agent.js';
import { OpenAiAgent } from '../agents/openai/openai_agent.js';

export type AgentFactoryDeps = {
  manifest: AgentManifest;
  tools: Tool[];
  mcp_servers?: McpServerHandle[];
};

export class AgentFactory {
  private constructor() {}

  /**
   * Build a runtime agent instance from a manifest and resolved tool list.
   * Sub-agent references (tool_agents / handoff_agents) are wired separately
   * by AgentRegistry via BaseAgent.setSubAgents() before compile().
   */
  static forManifest(deps: AgentFactoryDeps): BaseAgent {
    const { manifest, tools, mcp_servers } = deps;
    switch (manifest.engine) {
      case AgentEngine.OpenAi:
        return new OpenAiAgent({ manifest, tools, mcp_servers });
      default:
        throw new Error(`Unsupported agent engine: ${manifest.engine}`);
    }
  }
}
