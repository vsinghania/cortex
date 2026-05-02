import type { Tool } from '../types/agent.types.js';
import { NotFoundError } from '../../common/errors.js';
import { PingTool } from './builtin/ping_tool.js';

export class ToolRegistry {
  private static instance: ToolRegistry | null = null;

  private tools = new Map<string, Tool>();

  private constructor() {}

  static getInstance(): ToolRegistry {
    if (ToolRegistry.instance) return ToolRegistry.instance;
    const registry = new ToolRegistry();
    registry.registerBuiltins();
    ToolRegistry.instance = registry;
    return registry;
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  resolveAll(names: string[]): Tool[] {
    const resolved: Tool[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (!tool) missing.push(name);
      else resolved.push(tool);
    }
    if (missing.length) {
      throw new NotFoundError(`Unknown tool(s): ${missing.join(', ')}`);
    }
    return resolved;
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  private registerBuiltins(): void {
    this.registerMany([new PingTool()]);
  }
}
