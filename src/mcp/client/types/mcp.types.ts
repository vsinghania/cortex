/**
 * Minimal internal MCP type definitions used by our application.
 * These mirror core MCP concepts without importing the SDK types directly,
 * allowing us to keep a stable internal contract and adapt in our SDK wrapper.
 */

/** RPC call options (adapter will map to SDK RequestOptions). */
export type RpcOptions = {
  /** Timeout in milliseconds for the request. */
  timeout_ms?: number;
  /** Abort controller signal for cancellation. */
  signal?: AbortSignal;
  /** If true, progress notifications reset timeout. */
  reset_timeout_on_progress?: boolean;
  /** Maximum total time in ms regardless of progress updates. */
  max_total_timeout_ms?: number;
  /** Progress callback if the server supports it. */
  on_progress?: (progress: McpProgress) => void;
};

/** Generic progress payload (shape may vary by server/tool). */
export type McpProgress = {
  percent?: number;
  message?: string;
  [key: string]: unknown;
};

/** Common icon metadata. */
export type McpIcon = {
  src: string;
  mimeType?: string;
  sizes?: string[];
};

/** A resource payload embedded in content. */
export type McpEmbeddedResourceText = {
  uri: string;
  mimeType?: string;
  text: string;
  _meta?: Record<string, unknown>;
};

export type McpEmbeddedResourceBlob = {
  uri: string;
  mimeType?: string;
  blob: string; // base64-encoded
  _meta?: Record<string, unknown>;
};

export type McpEmbeddedResource = McpEmbeddedResourceText | McpEmbeddedResourceBlob;

/** Content variants as used by MCP messages/results. */
export type McpTextContent = {
  type: "text";
  text: string;
  _meta?: Record<string, unknown>;
};

export type McpImageContent = {
  type: "image";
  data: string; // base64-encoded
  mimeType: string;
  _meta?: Record<string, unknown>;
};

export type McpAudioContent = {
  type: "audio";
  data: string; // base64-encoded
  mimeType: string;
  _meta?: Record<string, unknown>;
};

export type McpResourceLinkBase = {
  name: string;
  title?: string;
  uri: string;
  description?: string;
  mimeType?: string;
  icons?: McpIcon[];
  _meta?: Record<string, unknown>;
};

export type McpResourceLinkContent = McpResourceLinkBase & {
  type: "resource_link";
};

export type McpResourceContent = {
  type: "resource";
  resource: McpEmbeddedResource;
  _meta?: Record<string, unknown>;
};

export type McpContent =
  | McpTextContent
  | McpImageContent
  | McpAudioContent
  | McpResourceLinkContent
  | McpResourceContent;

/** Tooling types */
export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolDescription = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;   // JSON Schema
  outputSchema?: unknown;  // JSON Schema
  annotations?: ToolAnnotations;
  icons?: McpIcon[];
  _meta?: Record<string, unknown>;
};

export type CallToolInput = {
  name: string;
  /** Arguments to the tool (validated by server against inputSchema). */
  arguments?: Record<string, unknown>;
};

export type CallToolResult = {
  /** Normalized result (SDK-native result variant) */
  content?: McpContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  /** Compatibility variant for older servers (SDK may return this variant). */
  toolResult?: unknown;
};

/** Resource types */
export type ResourceDescription = {
  name: string;
  title?: string;
  uri: string;
  description?: string;
  mimeType?: string;
  icons?: McpIcon[];
  _meta?: Record<string, unknown>;
};

export type ResourceReadText = {
  uri: string;
  mimeType?: string;
  text: string;
};

export type ResourceReadBlob = {
  uri: string;
  mimeType?: string;
  blob: string; // base64-encoded
};

export type ResourceReadContent = ResourceReadText | ResourceReadBlob;

export type ResourceReadResult = {
  contents: ResourceReadContent[];
  _meta?: Record<string, unknown>;
};

/** Prompts */
export type PromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

export type PromptDescription = {
  name: string;
  title?: string;
  description?: string;
  arguments?: PromptArgument[];
  icons?: McpIcon[];
  _meta?: Record<string, unknown>;
};

export type PromptMessage = {
  role: "user" | "assistant";
  content: McpContent | McpContent[];
};

export type PromptResult = {
  description?: string;
  messages: PromptMessage[];
  _meta?: Record<string, unknown>;
};

/** Notifications and logs */
export type McpNotification = {
  method: string;
  params?: unknown;
};

export type McpLogEvent = {
  level: "trace" | "debug" | "info" | "warn" | "error";
  message: string;
  details?: unknown;
  timestamp?: number;
};
