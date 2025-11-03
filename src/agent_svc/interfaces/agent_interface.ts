import type { AgentTool } from "../types/tool.types.js";
import type { AgentInput, AgentRunOptions, AgentResult, AgentEvent } from "../types/agent.types.js";
import type { McpClientInterface } from "../../mcp/client/interfaces/mcp_client_interface.js";

export interface Agent {
  run(input: AgentInput, options?: AgentRunOptions): Promise<AgentResult>;
  runStream?(input: AgentInput, options?: AgentRunOptions): AsyncIterable<AgentEvent>;

  // Tool registry
  registerTool(tool: AgentTool): void;
  registerTools(tools: AgentTool[]): void;
  listTools(): AgentTool[];

  // MCP clients
  addMcp(name: string, client: McpClientInterface): void;
  getMcp(name: string): McpClientInterface | undefined;
  listMcps(): string[];

  // Tool agents
  registerToolAgent(name: string, agent: Agent): void;
  getToolAgent(name: string): Agent | undefined;
  listToolAgents(): string[];

  // Handoff agents
  registerHandoffAgent(name: string, agent: Agent): void;
  getHandoffAgent(name: string): Agent | undefined;
  listHandoffAgents(): string[];

  dispose?(): Promise<void>;
}
