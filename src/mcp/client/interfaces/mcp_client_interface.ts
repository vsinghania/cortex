import type {
  ToolDescription,
  CallToolInput,
  CallToolResult,
  ResourceDescription,
  ResourceReadResult,
  PromptDescription,
  PromptResult,
  McpNotification,
  McpLogEvent,
  RpcOptions
} from "../types/mcp.types.js";

/**
 * Transport-agnostic MCP client interface (SDK-backed implementation will satisfy this).
 * Keep the rest of the app depending on this contract for easier DI and testing.
 */
export interface McpClientInterface {
  // lifecycle
  connect(): Promise<void>;
  initialize(): Promise<void>;
  isConnected(): boolean;
  shutdown(): Promise<void>;
  disconnect(): Promise<void>;

  // tools
  listTools(opts?: RpcOptions): Promise<ToolDescription[]>;
  callTool(input: CallToolInput, opts?: RpcOptions): Promise<CallToolResult>;

  // resources
  listResources(opts?: RpcOptions): Promise<ResourceDescription[]>;
  readResource(uri: string, opts?: RpcOptions): Promise<ResourceReadResult>;

  // prompts
  listPrompts(opts?: RpcOptions): Promise<PromptDescription[]>;
  getPrompt(name: string, args?: Record<string, unknown>, opts?: RpcOptions): Promise<PromptResult>;

  // observability
  onNotification(cb: (n: McpNotification) => void): () => void;
  onLog(cb: (e: McpLogEvent) => void): () => void;
}
