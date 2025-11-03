import type { AgentTool } from "../types/tool.types.js";

/**
 * Global Tool Registry (class-based singleton).
 * - Register tools once during app init.
 * - Factory (and other subsystems) can resolve tools from this registry.
 *
 * Future: For per-user scope, introduce a Map<user_id, ToolRegistry> and
 * select the appropriate registry for a given run. This class API remains valid.
 */
class ToolRegistry {
  private static INSTANCE: ToolRegistry | null = null;
  private tools = new Map<string, AgentTool>();
  private constructor() {}

  register(name: string, tool: AgentTool): void {
    this.tools.set(name, tool);
  }

  registerMany(input: Record<string, AgentTool> | AgentTool[]): void {
    if (Array.isArray(input)) {
      for (const t of input) this.tools.set(t.name, t);
    } else {
      for (const [name, t] of Object.entries(input)) this.tools.set(name, t);
    }
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  list(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  clear(): void {
    this.tools.clear();
  }

  static getInstance(): ToolRegistry {
    if (!this.INSTANCE) this.INSTANCE = new ToolRegistry();
    return this.INSTANCE;
  }
}

/** Singleton instance */
export const toolRegistry = ToolRegistry.getInstance();
