import type { AgentManifest } from '../types/agent.types.js';
import type { AgentRepositoryInterface } from '../repositories/agent_repository_interface.js';
import { MongooseAgentRepository } from '../repositories/mongoose_agent_repository.js';
import { ToolRegistry } from '../tools/tool_registry.js';
import { BaseAgent } from '../agents/base_agent.js';
import { AgentFactory } from '../factory/agent_factory.js';
import { NotFoundError } from '../../common/errors.js';
import { logger } from '../../common/logger.js';

export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private static in_flight: Promise<AgentRegistry> | null = null;

  private agents = new Map<string, BaseAgent>();

  private constructor(
    private readonly repo: AgentRepositoryInterface,
    private readonly tool_registry: ToolRegistry
  ) {}

  static async getInstance(): Promise<AgentRegistry> {
    if (AgentRegistry.instance) return AgentRegistry.instance;
    if (AgentRegistry.in_flight) return AgentRegistry.in_flight;

    AgentRegistry.in_flight = AgentRegistry.bootstrap()
      .then((inst) => {
        AgentRegistry.instance = inst;
        return inst;
      })
      .finally(() => {
        AgentRegistry.in_flight = null;
      });

    return AgentRegistry.in_flight;
  }

  static getExistingInstance(): AgentRegistry | null {
    return AgentRegistry.instance;
  }

  private static async bootstrap(): Promise<AgentRegistry> {
    const repo = await MongooseAgentRepository.create();
    const tool_registry = ToolRegistry.getInstance();
    const registry = new AgentRegistry(repo, tool_registry);
    await registry.refresh();
    return registry;
  }

  /**
   * Two-pass refresh:
   *   1) Build all agents (manifest + tools, no sub-agents yet).
   *   2) Wire sub-agent pointers (tool_agents, handoff_agents).
   *   3) Compile each agent (adapters perform vendor-side setup).
   */
  async refresh(): Promise<void> {
    const manifests = await this.repo.listEnabled();

    // Pass 1: build instances
    const next = new Map<string, BaseAgent>();
    for (const manifest of manifests) {
      try {
        const tools = this.tool_registry.resolveAll(manifest.tool_names);
        const agent = AgentFactory.forManifest({ manifest, tools });
        next.set(manifest.agent_id, agent);
      } catch (err) {
        logger.warn(
          { agent_id: manifest.agent_id, err },
          'Skipping agent: failed to build (unknown tool reference?)'
        );
      }
    }

    // Pass 2: wire sub-agent pointers
    for (const manifest of manifests) {
      const agent = next.get(manifest.agent_id);
      if (!agent) continue;
      const tool_agents = this.resolveSubAgents(next, manifest, manifest.tool_agent_ids, 'tool_agent');
      const handoff_agents = this.resolveSubAgents(next, manifest, manifest.handoff_agent_ids, 'handoff_agent');
      agent.setSubAgents({ tool_agents, handoff_agents });
    }

    // Pass 3: compile (adapters may chain into sub-agent compile via getSdkAgent())
    for (const agent of next.values()) {
      try {
        agent.compile();
      } catch (err) {
        logger.warn(
          { agent_id: agent.manifest.agent_id, err },
          'Agent failed to compile; removing from registry'
        );
        next.delete(agent.manifest.agent_id);
      }
    }

    this.agents = next;
    logger.info({ count: this.agents.size }, 'AgentRegistry loaded');
  }

  resolve(agent_id: string): BaseAgent {
    const agent = this.agents.get(agent_id);
    if (!agent) {
      throw new NotFoundError(`Agent not found or not enabled: ${agent_id}`);
    }
    return agent;
  }

  tryResolve(agent_id: string): BaseAgent | undefined {
    return this.agents.get(agent_id);
  }

  list(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  private resolveSubAgents(
    pool: Map<string, BaseAgent>,
    parent: AgentManifest,
    ids: string[],
    kind: 'tool_agent' | 'handoff_agent'
  ): BaseAgent[] {
    const out: BaseAgent[] = [];
    for (const id of ids) {
      const child = pool.get(id);
      if (!child) {
        logger.warn(
          { parent: parent.agent_id, missing_child: id, kind },
          'Skipping unresolved sub-agent reference'
        );
        continue;
      }
      out.push(child);
    }
    return out;
  }
}
