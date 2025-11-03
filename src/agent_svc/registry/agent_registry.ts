import type { Agent } from "../interfaces/agent_interface.js";

/**
 * Global Agent Registry (class-based singleton).
 * - Register agents once during app init.
 * - Other subsystems can resolve agents from this registry.
 *
 * This mirrors ToolRegistry to keep a single global namespace of agents.
 */
class AgentRegistry {
  private static INSTANCE: AgentRegistry | null = null;
  private agents = new Map<string, Agent>();
  private constructor() {}

  register(name: string, agent: Agent): void {
    this.agents.set(name, agent);
  }

  registerMany(input: Record<string, Agent>): void {
    for (const [name, a] of Object.entries(input)) this.agents.set(name, a);
  }

  get(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  delete(name: string): boolean {
    return this.agents.delete(name);
  }

  listNames(): string[] {
    return Array.from(this.agents.keys());
  }

  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  clear(): void {
    this.agents.clear();
  }

  /**
   * Dispose all agents that expose an async dispose() hook.
   */
  async disposeAll(): Promise<void> {
    for (const agent of this.agents.values()) {
      if (typeof agent.dispose === "function") {
        try {
          await agent.dispose();
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  static getInstance(): AgentRegistry {
    if (!this.INSTANCE) this.INSTANCE = new AgentRegistry();
    return this.INSTANCE;
  }
}

/** Singleton instance */
export const agentRegistry = AgentRegistry.getInstance();
