import {
  Agent,
  run as runAgent,
  tool as makeTool,
  MaxTurnsExceededError,
  type JsonSchemaDefinition,
} from '@openai/agents';
import { BaseAgent, type BaseAgentInit } from '../base_agent.js';
import type {
  AgentManifest,
  AgentRunRequest,
  AgentRunResponse,
  Tool as DomainTool,
} from '../../types/agent.types.js';
import type { Message } from '../../types/message.types.js';
import { OpenAiSdkUtils } from './openai_sdk_utils.js';
import { logExecTime } from '../../../lib/decorators/logging_decorators.js';
import { Time } from '../../../lib/time.js';
import { McpServerMode } from '../../types/mcp_server.types.js';
import { performance } from 'node:perf_hooks';

const DEFAULT_MAX_TURNS = 10;

export class OpenAiAgent extends BaseAgent {
  private sdk_agent!: Agent<unknown, any>;
  private readonly default_model: string;

  constructor(init: BaseAgentInit) {
    super(init);
    this.default_model = process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-5.4-nano';
  }

  /**
   * Returns the underlying SDK Agent. Triggers compile() on first access so
   * sub-agent wiring resolves lazily and tolerates cycles.
   */
  getSdkAgent(): Agent<unknown, any> {
    this.compile();
    return this.sdk_agent;
  }

  effectiveModel(): string {
    return this.manifest.model ?? this.default_model;
  }

  protected onCompile(): void {
    const fn_tools = this.tools.map((t) => this.toSdkTool(t));
    const tool_agent_tools = this.buildToolAgentTools();
    const handoffs = this.buildHandoffs();
    const { self_hosted_servers, hosted_tools } = this.partitionMcpHandles();
    const output_type = OpenAiAgent.toSdkOutputType(this.manifest);

    this.sdk_agent = new Agent({
      name: this.manifest.name,
      instructions: this.instructions,
      model: this.effectiveModel(),
      tools: [...fn_tools, ...tool_agent_tools, ...hosted_tools],
      mcpServers: self_hosted_servers,
      handoffs,
      ...(output_type ? { outputType: output_type } : {}),
    });
  }

  private static toSdkOutputType(manifest: AgentManifest): JsonSchemaDefinition | undefined {
    if (!manifest.output_schema) return undefined;
    return {
      type: 'json_schema',
      name: OpenAiAgent.sanitizeOutputName(manifest.name),
      strict: true,
      schema: manifest.output_schema,
    };
  }

  private static sanitizeOutputName(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const fallback = cleaned.length > 0 ? cleaned : 'AgentOutput';
    return fallback.slice(0, 64);
  }

  private partitionMcpHandles() {
    const self_hosted_servers = this.mcp_servers
      .filter((h) => h.mode === McpServerMode.SelfHosted)
      .map((h) => (h.mode === McpServerMode.SelfHosted ? h.sdk_server : null))
      .filter((s): s is NonNullable<typeof s> => s !== null);
    const hosted_tools = this.mcp_servers
      .filter((h) => h.mode === McpServerMode.PublicHosted)
      .map((h) => (h.mode === McpServerMode.PublicHosted ? h.sdk_tool : null))
      .filter((t): t is NonNullable<typeof t> => t !== null);
    return { self_hosted_servers, hosted_tools };
  }

  @logExecTime({ threshold_in_ms: 5000 })
  protected async onRun(req: AgentRunRequest): Promise<AgentRunResponse> {
    const input = this.buildSdkInput(req);
    const max_turns = req.options?.max_turns ?? DEFAULT_MAX_TURNS;

    this.logger().info(
      {
        agent_id: this.manifest.agent_id,
        agent_name: this.manifest.name,
        max_turns,
        tool_count: this.tools.length,
        tool_agent_count: this.tool_agents.length,
        handoff_count: this.handoff_agents.length,
        has_previous_response_id: !!req.previous_response_id,
      },
      'OpenAiAgent.run starting'
    );

    const start_ms = performance.now();
    try {
      const result = await runAgent(this.sdk_agent, input, { maxTurns: max_turns });
      const response = this.toAgentResponse(req, result);
      this.logger().info(
        {
          agent_id: this.manifest.agent_id,
          model: response.model,
          message_count: response.message_history.length,
          stop_reason: response.stop_reason,
          duration_ms: Time.elapsedMs(start_ms),
        },
        'OpenAiAgent.run completed'
      );
      return response;
    } catch (err) {
      if (err instanceof MaxTurnsExceededError) {
        this.logger().warn(
          {
            agent_id: this.manifest.agent_id,
            err: err.message,
            duration_ms: Time.elapsedMs(start_ms),
          },
          'Agent run hit max turns'
        );
        return this.maxTurnsResponse(req);
      }
      this.logger().error(
        {
          agent_id: this.manifest.agent_id,
          err,
          duration_ms: Time.elapsedMs(start_ms),
        },
        'Agent run failed'
      );
      throw err;
    }
  }

  // --- private helpers ---

  private toSdkTool(domain_tool: DomainTool) {
    const ctx_logger = this.logger();
    return makeTool({
      name: domain_tool.name,
      description: domain_tool.description,
      parameters: domain_tool.input_schema as any,
      strict: true,
      execute: async (args: unknown) => {
        const parsed = domain_tool.input_schema.parse(args);
        const result = await domain_tool.execute(parsed, { logger: ctx_logger });
        return OpenAiSdkUtils.serializeToolResult(result);
      },
    });
  }

  private buildToolAgentTools() {
    const out: any[] = [];
    for (const child of this.tool_agents) {
      if (!(child instanceof OpenAiAgent)) {
        this.logger().warn(
          {
            parent: this.manifest.agent_id,
            child: child.manifest.agent_id,
            child_engine: child.manifest.engine,
          },
          'Skipping tool_agent: cross-engine tool_agents are not supported'
        );
        continue;
      }
      const child_sdk = child.getSdkAgent();
      out.push(
        child_sdk.asTool({
          toolName: child.manifest.name.replace(/\s+/g, '_'),
          toolDescription: `Delegate to the "${child.manifest.name}" sub-agent.`,
        })
      );
    }
    return out;
  }

  private buildHandoffs(): Agent<any, any>[] {
    const out: Agent<any, any>[] = [];
    for (const child of this.handoff_agents) {
      if (!(child instanceof OpenAiAgent)) {
        this.logger().warn(
          {
            parent: this.manifest.agent_id,
            child: child.manifest.agent_id,
            child_engine: child.manifest.engine,
          },
          'Skipping handoff_agent: cross-engine handoffs are not supported'
        );
        continue;
      }
      out.push(child.getSdkAgent());
    }
    return out;
  }

  private buildSdkInput(req: AgentRunRequest) {
    if (typeof req.input === 'string' && (!req.message_history || req.message_history.length === 0)) {
      return req.input;
    }
    const all_messages: Message[] = [
      ...(req.message_history ?? []),
      ...this.userMessageFromInput(req),
    ];
    return OpenAiSdkUtils.toSdkInput(all_messages);
  }

  private toAgentResponse(req: AgentRunRequest, result: any): AgentRunResponse {
    const new_messages = OpenAiSdkUtils.extractMessages(result);
    const final_text = OpenAiSdkUtils.extractFinalText(result);
    const final_json = this.manifest.output_schema
      ? OpenAiSdkUtils.extractFinalJson(result)
      : undefined;
    const usage = OpenAiSdkUtils.extractUsage(result);
    const model_name =
      OpenAiSdkUtils.extractModelName(result) ?? this.effectiveModel();

    const message_history: Message[] = [
      ...(req.message_history ?? []),
      ...this.userMessageFromInput(req),
      ...new_messages,
    ];

    return {
      final_output_text: final_text,
      final_output_json: final_json,
      message_history,
      usage,
      model: model_name,
      conversation_id: req.conversation_id,
      stop_reason: 'final',
    };
  }

  private maxTurnsResponse(req: AgentRunRequest): AgentRunResponse {
    const message_history: Message[] = [
      ...(req.message_history ?? []),
      ...this.userMessageFromInput(req),
    ];
    return {
      final_output_text: undefined,
      final_output_json: undefined,
      message_history,
      usage: this.emptyUsage(),
      model: this.effectiveModel(),
      conversation_id: req.conversation_id,
      stop_reason: 'max_turns',
    };
  }
}
