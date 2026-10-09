import type { AgentManifest, Tool } from '../types/agent.types.js';
import { AgentEngine } from '../types/agent.types.js';
import type { McpServerHandle } from '../registry/mcp_server_registry.js';
import { BaseAgent } from '../agents/base_agent.js';
import { OpenAiAgent } from '../agents/openai/openai_agent.js';
import { InstructionComposer } from '../instructions/instruction_composer.js';

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
   * Throws on an unknown instruction policy name, as on an unknown tool.
   */
  static createAgentFromManifest(deps: AgentFactoryDeps): BaseAgent {
    const { manifest, tools, mcp_servers } = deps;
    const instructions = InstructionComposer.composeManifestInstructions(manifest);
    switch (manifest.engine) {
      case AgentEngine.OpenAi:
        return new OpenAiAgent({ manifest, instructions, tools, mcp_servers });
      default:
        throw new Error(`Unsupported agent engine: ${manifest.engine}`);
    }
  }
}
