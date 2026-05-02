import type { AgentManifest, Tool } from '../types/agent.types.js';
import { AgentImplKind } from '../types/agent.types.js';
import { BaseAgent } from '../agents/base_agent.js';
import { OpenAiAgent } from '../agents/openai/openai_agent.js';

export type AgentFactoryDeps = {
  manifest: AgentManifest;
  tools: Tool[];
};

export class AgentFactory {
  private constructor() {}

  /**
   * Build a runtime agent instance from a manifest and resolved tool list.
   * Sub-agent references (tool_agents / handoff_agents) are wired separately
   * by AgentRegistry via BaseAgent.setSubAgents() before compile().
   */
  static forManifest(deps: AgentFactoryDeps): BaseAgent {
    const { manifest, tools } = deps;
    switch (manifest.implementation) {
      case AgentImplKind.OpenAiAgents:
        return new OpenAiAgent({ manifest, tools });
      default:
        throw new Error(`Unsupported agent implementation: ${manifest.implementation}`);
    }
  }
}
