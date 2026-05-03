import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { logger } from "../../../common/logger.js";
import type { McpClientInterface } from "../interfaces/mcp_client_interface.js";
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
  RpcOptions,
} from "../types/mcp.types.js";
import type { ClientInfo, HttpConfig } from "../types/mcp_config.types.js";

/**
 * SDK-backed MCP client using Streamable HTTP transport.
 */
export class HttpMcpClient implements McpClientInterface {
  private client: Client;
  private transport?: StreamableHTTPClientTransport;
  private state: 'idle' | 'connecting' | 'connected' | 'closing' = 'idle';
  private connectPromise?: Promise<void>;

  private notification_listeners = new Set<(n: McpNotification) => void>();
  private log_listeners = new Set<(e: McpLogEvent) => void>();

  constructor(
    private cfg: { client?: ClientInfo; http: HttpConfig },
    private log = logger
  ) {
    const info = cfg.client ?? { name: "cortex", version: "1.0.0" };
    this.client = new Client(info);

    this.client.onerror = (err: Error) => {
      if (this.isExpectedShutdownError(err)) {
        return;
      }
      this.emitLog({ level: "error", message: "mcp_client_error", details: err, timestamp: Date.now() });
    };
    this.client.onclose = () => {
      this.state = 'idle';
      this.emitLog({ level: "info", message: "mcp_client_closed", timestamp: Date.now() });
    };

    this.client.fallbackNotificationHandler = async (notification) => {
      this.emitNotification({ method: notification.method, params: (notification as any).params });
    };
  }

  async connect(): Promise<void> {
    if (this.state === 'connected') return;
    if (this.state === 'connecting' && this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.state = 'connecting';
    this.connectPromise = this.runConnect();
    await this.connectPromise;
  }

  private async runConnect(): Promise<void> {
    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(this.cfg.http.base_url),
        {
          requestInit: {
            headers: HttpMcpClient.buildHeaders(this.cfg.http)
          }
        }
      );

      const timeout = this.cfg.http.startup_timeout_ms;
      try {
        await this.client.connect(transport, timeout ? { timeout } : undefined);
        this.transport = transport;
        this.state = 'connected';
        this.emitLog({ level: "info", message: "mcp_client_connected", timestamp: Date.now() });
      } catch (err) {
        this.state = 'idle';
        try { await transport.close(); } catch {}
        throw err;
      }
    } finally {
      this.connectPromise = undefined;
    }
  }

  async initialize(): Promise<void> {
    await this.connect();
    await this.client.ping().catch((err) => {
      this.emitLog({ level: "warn", message: "mcp_client_ping_failed", details: err, timestamp: Date.now() });
      throw err;
    });
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  async shutdown(): Promise<void> {
    if (this.state === 'connecting' && this.connectPromise) {
      try { await this.connectPromise; } catch {}
    }
    if (this.state !== 'connected') {
      this.state = 'idle';
      return;
    }
    this.state = 'closing';
    try {
      await this.client.close();
    } finally {
      this.state = 'idle';
    }
  }

  async disconnect(): Promise<void> {
    await this.shutdown();
  }

  async listTools(opts?: RpcOptions): Promise<ToolDescription[]> {
    const res = await this.client.listTools(undefined, HttpMcpClient.toRequestOptions(opts));
    return res.tools as unknown as ToolDescription[];
  }

  async callTool(input: CallToolInput, opts?: RpcOptions): Promise<CallToolResult> {
    const res = await this.client.callTool(
      { name: input.name, arguments: input.arguments },
      undefined,
      HttpMcpClient.toRequestOptions(opts)
    );
    return res as unknown as CallToolResult;
  }

  async listResources(opts?: RpcOptions): Promise<ResourceDescription[]> {
    const res = await this.client.listResources(undefined, HttpMcpClient.toRequestOptions(opts));
    return res.resources as unknown as ResourceDescription[];
  }

  async readResource(uri: string, opts?: RpcOptions): Promise<ResourceReadResult> {
    const res = await this.client.readResource({ uri }, HttpMcpClient.toRequestOptions(opts));
    return res as unknown as ResourceReadResult;
  }

  async listPrompts(opts?: RpcOptions): Promise<PromptDescription[]> {
    const res = await this.client.listPrompts(undefined, HttpMcpClient.toRequestOptions(opts));
    return res.prompts as unknown as PromptDescription[];
  }

  async getPrompt(name: string, args?: Record<string, unknown>, opts?: RpcOptions): Promise<PromptResult> {
    const argMap = args
      ? (Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)])) as Record<string, string>)
      : undefined;
    const res = await this.client.getPrompt({ name, arguments: argMap }, HttpMcpClient.toRequestOptions(opts));
    return res as unknown as PromptResult;
  }

  onNotification(cb: (n: McpNotification) => void): () => void {
    this.notification_listeners.add(cb);
    return () => this.notification_listeners.delete(cb);
  }

  onLog(cb: (e: McpLogEvent) => void): () => void {
    this.log_listeners.add(cb);
    return () => this.log_listeners.delete(cb);
  }

  private emitNotification(n: McpNotification) {
    this.notification_listeners.forEach((cb) => {
      try {
        cb(n);
      } catch (err) {
        this.log.warn({ err }, "mcp_notification_listener_error");
      }
    });
  }

  private emitLog(e: McpLogEvent) {
    const lvl = e.level ?? "info";
    if (typeof (this.log as any)[lvl] === "function") {
      (this.log as any)[lvl](e.details ?? {}, e.message);
    } else {
      this.log.info(e.details ?? {}, e.message);
    }
    this.log_listeners.forEach((cb) => {
      try {
        cb(e);
      } catch (err) {
        this.log.warn({ err }, "mcp_log_listener_error");
      }
    });
  }

  private static buildHeaders(http: HttpConfig): HeadersInit {
    const headers: Record<string, string> = {
      ...(http.headers ?? {})
    };

    if (http.auth_token) {
      headers.Authorization = `Bearer ${http.auth_token}`;
    }

    return headers;
  }

  private isExpectedShutdownError(err: Error): boolean {
    return (
      this.state !== 'connected' &&
      err.message.includes("SSE stream disconnected: AbortError")
    );
  }

  private static toRequestOptions(opts?: RpcOptions) {
    if (!opts) return undefined;
    return {
      timeout: opts.timeout_ms,
      signal: opts.signal,
      onprogress: opts.on_progress ? (p: any) => opts.on_progress?.(p) : undefined,
      resetTimeoutOnProgress: opts.reset_timeout_on_progress,
      maxTotalTimeout: opts.max_total_timeout_ms,
    } as const;
  }
}
