import type { AgentManifest } from '../types/agent.types.js';
import { MongooseAgentRepository } from '../repositories/mongoose_agent_repository.js';
import { ToolRegistry } from '../tools/tool_registry.js';
import { McpServerRegistry } from './mcp_server_registry.js';
import { BaseAgent } from '../agents/base_agent.js';
import { AgentFactory } from '../factory/agent_factory.js';
import { NotFoundError } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { TraceContext } from '../../common/trace_context.js';
import { Time } from '../../lib/time.js';

const REFRESH_INTERVAL_MS = Time.minutesToMs(10);

export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private static in_flight: Promise<AgentRegistry> | null = null;

  private agents = new Map<string, BaseAgent>();
  private refresh_timer: NodeJS.Timeout | null = null;

  private constructor() {}

  static async getInstance(): Promise<AgentRegistry> {
    if (AgentRegistry.instance) return AgentRegistry.instance;
    if (AgentRegistry.in_flight) return AgentRegistry.in_flight;

    AgentRegistry.in_flight = AgentRegistry.loadInstance();
    return AgentRegistry.in_flight;
  }

  private static async loadInstance(): Promise<AgentRegistry> {
    try {
      const inst = await AgentRegistry.bootstrap();
      AgentRegistry.instance = inst;
      return inst;
    } finally {
      AgentRegistry.in_flight = null;
    }
  }

  static getExistingInstance(): AgentRegistry | null {
    return AgentRegistry.instance;
  }

  private static async bootstrap(): Promise<AgentRegistry> {
    // Eagerly initialize the registries so the first refresh() call below
    // sees them ready (McpServerRegistry.getInstance() is async).
    ToolRegistry.getInstance();
    const mcp_server_registry = await McpServerRegistry.getInstance();
    mcp_server_registry.startPeriodicRefresh();
    const registry = new AgentRegistry();
    await registry.refresh();
    registry.startPeriodicRefresh();
    return registry;
  }

  startPeriodicRefresh(): void {
    if (this.refresh_timer) return;
    this.refresh_timer = setInterval(async () => {
      TraceContext.enterBackground('agent-registry');
      try {
        await this.refresh();
      } catch (err) {
        logger.warn({ err }, 'AgentRegistry periodic refresh failed');
      }
    }, REFRESH_INTERVAL_MS);
    this.refresh_timer.unref?.();
    logger.info({ interval_ms: REFRESH_INTERVAL_MS }, 'AgentRegistry periodic refresh started');
  }

  stopPeriodicRefresh(): void {
    if (!this.refresh_timer) return;
    clearInterval(this.refresh_timer);
    this.refresh_timer = null;
  }

  /**
   * Two-pass refresh:
   *   1) Build all agents (manifest + tools, no sub-agents yet).
   *   2) Wire sub-agent pointers (tool_agents, handoff_agents).
   *   3) Compile each agent (adapters perform vendor-side setup).
   */
  async refresh(): Promise<void> {
    const repo = await MongooseAgentRepository.create();
    const manifests = await repo.listEnabled();
    const tool_registry = ToolRegistry.getInstance();
    const mcp_server_registry = await McpServerRegistry.getInstance();

    // Pass 1: build instances
    const next = new Map<string, BaseAgent>();
    for (const manifest of manifests) {
      try {
        const tools = tool_registry.resolveAll(manifest.tool_names);
        const mcp_servers = mcp_server_registry.resolveAll(manifest.mcp_server_ids);
        const agent = AgentFactory.forManifest({ manifest, tools, mcp_servers });
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
