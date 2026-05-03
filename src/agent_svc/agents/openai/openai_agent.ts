import {
  Agent,
  run as runAgent,
  tool as makeTool,
  MaxTurnsExceededError,
} from '@openai/agents';
import { BaseAgent, type BaseAgentInit } from '../base_agent.js';
import type {
  AgentRunRequest,
  AgentRunResponse,
  Tool as DomainTool,
} from '../../types/agent.types.js';
import type { PromptMessage } from '../../../ai_svc/types/ai_prompt.types.js';
import { Role } from '../../../ai_svc/types/ai_prompt.types.js';
import { OpenAiSdkUtils } from './openai_sdk_utils.js';
import { logExecTime } from '../../../lib/decorators/logging_decorators.js';
import { McpServerMode } from '../../types/mcp_server.types.js';

const DEFAULT_MAX_TURNS = 10;

export class OpenAiAgent extends BaseAgent {
  private sdk_agent!: Agent<unknown, any>;
  private readonly default_model: string;

  constructor(init: BaseAgentInit) {
    super(init);
    this.default_model = process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4o-mini';
  }

  /**
   * Returns the underlying SDK Agent. Triggers compile() on first access so
   * sub-agent wiring resolves lazily and tolerates cycles.
   */
  getSdkAgent(): Agent<unknown, any> {
    this.compile();
    return this.sdk_agent;
  }

  protected onCompile(): void {
    const fn_tools = this.tools.map((t) => this.toSdkTool(t));
    const tool_agent_tools = this.buildToolAgentTools();
    const handoffs = this.buildHandoffs();
    const { self_hosted_servers, hosted_tools } = this.partitionMcpHandles();

    this.sdk_agent = new Agent({
      name: this.manifest.name,
      instructions: this.manifest.instructions,
      model: this.manifest.model ?? this.default_model,
      tools: [...fn_tools, ...tool_agent_tools, ...hosted_tools],
      mcpServers: self_hosted_servers,
      handoffs,
    });
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
      },
      'OpenAiAgent.run starting'
    );

    try {
      const result = await runAgent(this.sdk_agent, input, { maxTurns: max_turns });
      return this.toAgentResponse(req, result);
    } catch (err) {
      if (err instanceof MaxTurnsExceededError) {
        this.logger().warn(
          { agent_id: this.manifest.agent_id, err: err.message },
          'Agent run hit max turns'
        );
        return this.maxTurnsResponse(req);
      }
      this.logger().error(
        { agent_id: this.manifest.agent_id, err },
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
            child_impl: child.manifest.implementation,
          },
          'Skipping tool_agent: cross-implementation tool_agents are not supported'
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
            child_impl: child.manifest.implementation,
          },
          'Skipping handoff_agent: cross-implementation handoffs are not supported'
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

    const history = req.message_history ?? [];
    const latest_messages: PromptMessage[] =
      typeof req.input === 'string'
        ? [{ role: Role.USER, content: req.input }]
        : req.input;

    return OpenAiSdkUtils.toSdkInput([...history, ...latest_messages]);
  }

  private toAgentResponse(req: AgentRunRequest, result: any): AgentRunResponse {
    const tool_calls = OpenAiSdkUtils.extractToolInvocations(result);
    const final_text = OpenAiSdkUtils.extractFinalText(result);
    const usage = OpenAiSdkUtils.extractUsage(result);
    const model_name =
      OpenAiSdkUtils.extractModelName(result) ??
      this.manifest.model ??
      this.default_model;

    const user_text = this.extractLastUserText(req);
    const message_history = this.appendUserAssistant(req, user_text, final_text);

    return {
      final_output_text: final_text,
      final_output_json: undefined,
      message_history,
      tool_calls,
      usage,
      model: model_name,
      response_id: result?.lastResponseId,
      conversation_id: req.conversation_id,
      stop_reason: 'final',
    };
  }

  private maxTurnsResponse(req: AgentRunRequest): AgentRunResponse {
    const user_text = this.extractLastUserText(req);
    const message_history = [
      ...(req.message_history ?? []),
      { role: Role.USER, content: user_text },
    ];
    return {
      final_output_text: undefined,
      final_output_json: undefined,
      message_history,
      tool_calls: [],
      usage: this.emptyUsage(),
      model: this.manifest.model ?? this.default_model,
      response_id: undefined,
      conversation_id: req.conversation_id,
      stop_reason: 'max_turns',
    };
  }
}
