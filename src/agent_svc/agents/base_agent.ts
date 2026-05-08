import type { Logger } from 'pino';
import type {
  AgentManifest,
  AgentRunRequest,
  AgentRunResponse,
  AgentUsage,
  Tool,
  ToolContext,
} from '../types/agent.types.js';
import { Role, MessageContent, type Message } from '../types/message.types.js';
import type { McpServerHandle } from '../registry/mcp_server_registry.js';
import { logger as base_logger } from '../../common/logger.js';
import { TraceContext } from '../../common/trace_context.js';
import { Id } from '../../lib/id.js';

/**
 * Construction params for a BaseAgent. The runtime references to
 * tool_agents / handoff_agents are wired by AgentRegistry after all agents
 * are instantiated, so they may be left empty at construction and filled
 * later via setSubAgents().
 */
export type BaseAgentInit = {
  manifest: AgentManifest;
  tools: Tool[];
  tool_agents?: BaseAgent[];
  handoff_agents?: BaseAgent[];
  mcp_servers?: McpServerHandle[];
};

/**
 * Abstract base for all agent implementations. Concrete subclasses (e.g.
 * OpenAiAgent) override onCompile() and onRun().
 *
 * Instances are shared across requests for a given agent_id. Do NOT store
 * per-invocation state on `this`; build per-call state inside onRun().
 */
export abstract class BaseAgent {
  readonly manifest: AgentManifest;
  readonly tools: Tool[];
  readonly mcp_servers: McpServerHandle[];

  // Mutable only during registry wiring; treat as read-only after compile().
  private _tool_agents: BaseAgent[];
  private _handoff_agents: BaseAgent[];
  private compiled = false;

  protected constructor(init: BaseAgentInit) {
    this.manifest = init.manifest;
    this.tools = init.tools;
    this._tool_agents = init.tool_agents ?? [];
    this._handoff_agents = init.handoff_agents ?? [];
    this.mcp_servers = init.mcp_servers ?? [];
  }

  get tool_agents(): readonly BaseAgent[] {
    return this._tool_agents;
  }

  get handoff_agents(): readonly BaseAgent[] {
    return this._handoff_agents;
  }

  /** Wires sub-agent references. Must be called before compile(). */
  setSubAgents(params: { tool_agents: BaseAgent[]; handoff_agents: BaseAgent[] }): void {
    if (this.compiled) {
      throw new Error(
        `Cannot set sub-agents on already-compiled agent: ${this.manifest.agent_id}`
      );
    }
    this._tool_agents = params.tool_agents;
    this._handoff_agents = params.handoff_agents;
  }

  /** Idempotent one-time setup. Adapters override onCompile(). */
  compile(): void {
    if (this.compiled) return;
    this.onCompile();
    this.compiled = true;
  }

  isCompiled(): boolean {
    return this.compiled;
  }

  /**
   * Public run entrypoint. Ensures compile(), delegates to onRun(),
   * normalizes errors. Subclasses override onRun() rather than this.
   */
  async run(req: AgentRunRequest): Promise<AgentRunResponse> {
    this.compile();
    const existing = TraceContext.get();
    TraceContext.enter({
      trace_id: existing?.trace_id ?? Id.generateRandom(),
      user_id: req.user_id ?? existing?.user_id,
      upstream_trace_id: existing?.upstream_trace_id,
    });
    return this.onRun(req);
  }

  // --- abstract: each adapter implements ---
  protected abstract onCompile(): void;
  protected abstract onRun(req: AgentRunRequest): Promise<AgentRunResponse>;

  // --- shared helpers ---

  protected logger(): Logger {
    return base_logger;
  }

  protected buildToolContext(req: AgentRunRequest): ToolContext {
    return {
      user_id: req.user_id,
      conversation_id: req.conversation_id,
      logger: this.logger(),
    };
  }

  protected emptyUsage(): AgentUsage {
    return { prompt_tokens: 0, response_tokens: 0, total_tokens: 0 };
  }

  protected extractLastUserText(req: AgentRunRequest): string {
    const messages = this.userMessageFromInput(req);
    const last = messages[messages.length - 1];
    if (!last) return '';
    return MessageContent.toText(last.content);
  }

  protected appendMessages(req: AgentRunRequest, new_messages: Message[]): Message[] {
    return [...(req.message_history ?? []), ...new_messages];
  }

  protected userMessageFromInput(req: AgentRunRequest): Message[] {
    if (typeof req.input === 'string') {
      return [{ role: Role.User, content: MessageContent.text(req.input) }];
    }
    return req.input;
  }
}
