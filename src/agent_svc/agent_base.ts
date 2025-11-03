import { logger } from "../common/logger.js";
import { HttpError, InternalServerError } from "../common/errors.js";
import type { McpClientInterface } from "../mcp/client/interfaces/mcp_client_interface.js";
import type { Agent } from "./interfaces/agent_interface.js";
import type { AgentInput, AgentRunOptions, AgentResult, AgentEvent } from "./types/agent.types.js";
import type { AgentTool, ToolContext, ToolResult } from "./types/tool.types.js";
import { z, type ZodTypeAny } from "zod";

export abstract class AgentBase implements Agent {
  protected readonly name: string;
  protected readonly instructions: string;
  protected readonly tools = new Map<string, AgentTool>();
  protected readonly mcp_clients = new Map<string, McpClientInterface>();
  protected readonly tool_agents = new Map<string, Agent>();
  protected readonly handoff_agents = new Map<string, Agent>();

  constructor(name: string, instructions: string) {
    this.name = name;
    this.instructions = instructions;
  }

  registerTool(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      logger.warn({ tool: tool.name }, "Overwriting existing tool registration");
    }
    this.tools.set(tool.name, tool);
  }

  registerTools(tools: AgentTool[]): void {
    for (const t of tools) this.registerTool(t);
  }

  listTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  addMcp(name: string, client: McpClientInterface): void {
    if (this.mcp_clients.has(name)) {
      logger.warn({ mcp: name }, "Overwriting existing MCP client");
    }
    this.mcp_clients.set(name, client);
  }

  getMcp(name: string): McpClientInterface | undefined {
    return this.mcp_clients.get(name);
  }

  listMcps(): string[] {
    return Array.from(this.mcp_clients.keys());
  }

  registerToolAgent(name: string, agent: Agent): void {
    if (this.tool_agents.has(name)) {
      logger.warn({ agent: name }, "Overwriting existing tool agent");
    }
    this.tool_agents.set(name, agent);
  }

  getToolAgent(name: string): Agent | undefined {
    return this.tool_agents.get(name);
  }

  listToolAgents(): string[] {
    return Array.from(this.tool_agents.keys());
  }

  registerHandoffAgent(name: string, agent: Agent): void {
    if (this.handoff_agents.has(name)) {
      logger.warn({ agent: name }, "Overwriting existing handoff agent");
    }
    this.handoff_agents.set(name, agent);
  }

  getHandoffAgent(name: string): Agent | undefined {
    return this.handoff_agents.get(name);
  }

  listHandoffAgents(): string[] {
    return Array.from(this.handoff_agents.keys());
  }

  protected validateToolArgs<P extends ZodTypeAny>(tool: AgentTool<P>, args: unknown): z.infer<P> {
    if (!tool.parameters) return args as z.infer<P>;
    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      throw new HttpError(400, "tool_validation_error", "Invalid tool arguments", {
        details: { tool: tool.name, issues: parsed.error.issues }
      });
    }
    return parsed.data as z.infer<P>;
  }

  protected async callTool(tool_name: string, args: unknown, ctx: ToolContext): Promise<ToolResult<unknown>> {
    const tool = this.tools.get(tool_name);
    if (!tool) {
      throw new HttpError(404, "tool_not_found", `Tool '${tool_name}' not registered`);
    }
    const validated = this.validateToolArgs(tool, args);
    return tool.handler(validated, ctx);
  }

  protected normalizeError(err: unknown): HttpError {
    if (HttpError.isHttpError(err)) return err;
    if (err instanceof Error) return new InternalServerError(err.message, { cause: err });
    return new InternalServerError("Unknown error", { cause: err });
  }

  protected createAbortController(timeout_ms?: number) {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    if (timeout_ms && timeout_ms > 0) {
      timer = setTimeout(() => controller.abort(), timeout_ms);
    }
    return {
      controller,
      clear: () => {
        if (timer) clearTimeout(timer);
      }
    };
  }

  protected async beforeRun(_input: AgentInput, _options?: AgentRunOptions): Promise<void> { /* no-op */ }
  protected async afterRun(_input: AgentInput, _options: AgentRunOptions | undefined, _result: AgentResult): Promise<void> { /* no-op */ }

  abstract run(input: AgentInput, options?: AgentRunOptions): Promise<AgentResult>;
  runStream?(input: AgentInput, options?: AgentRunOptions): AsyncIterable<AgentEvent>;
}
