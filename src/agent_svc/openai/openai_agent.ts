import { AgentBase } from '../agent_base.js';
import { Agent as SdkAgent, run } from '@openai/agents';
import { OpenAiConverters } from './openai_converters.js';
import type { AgentInput, AgentRunOptions, AgentResult, AgentMessage } from '../types/agent.types.js';
import { mcp_config_schema, type McpConfig } from '../../mcp/client/types/mcp_config.types.js';
import { logger } from '../../common/logger.js';

export class OpenAiAgent extends AgentBase {
  public async run(input: AgentInput, options?: AgentRunOptions): Promise<AgentResult> {
    await this.beforeRun(input, options);
    const { controller, clear } = this.createAbortController(options?.timeout_ms);

    try {
      // Model selection (env override -> default)
      const model = process.env.OPENAI_MODEL || 'gpt-4.1';

      // Convert in-process tools to Agents SDK tools
      const function_tools = this.listTools().map(OpenAiConverters.toSdkFunctionTool);

      // Build MCP servers from provided config(s) in options.metadata or input.context
      let mcp_servers: unknown[] = [];
      const raw_cfgs =
        (options?.metadata as Record<string, unknown> | undefined)?.['mcp_configs'] ??
        (input.context as Record<string, unknown> | undefined)?.['mcp_configs'];

      let mcp_configs: McpConfig[] = [];
      if (raw_cfgs) {
        if (Array.isArray(raw_cfgs)) {
          mcp_configs = (raw_cfgs as unknown[]).map((r) => mcp_config_schema.parse(r));
        } else {
          mcp_configs = [mcp_config_schema.parse(raw_cfgs)];
        }
        mcp_servers = await OpenAiConverters.buildMcpServersFromConfig(mcp_configs);
      }

      // TODO: Tool agents as tools and handoffs integration can be added when sub-agents are OpenAI-backed
      // const agent_tools = Array.from(this.tool_agents.entries()).map(([name, agent]) => ... );
      // const handoffs = Array.from(this.handoff_agents.values());

      // Construct the Agents SDK Agent
      const sdk_agent = new SdkAgent({
        name: (this as any).name,
        instructions: (this as any).instructions,
        model,
        modelSettings: { toolChoice: 'required' },
        tools: function_tools,
        mcpServers: mcp_servers as any
        // handoffs
      });

      // Build run context (passed to tools and hooks)
      const run_context = {
        ...(input.context ?? {}),
        user_id: input.user_id,
        metadata: options?.metadata,
        logger
      };

      // Compose user input. Prefer the explicit prompt; messages history support can be expanded later.
      const user_input = input.prompt ?? '';

      // Execute the agent
      const output = await run(sdk_agent, user_input, {
        context: run_context as any,
        signal: controller.signal
      });
      const final_text = typeof output === 'string' ? output : JSON.stringify(output);

      // Minimal message reconstruction with strong typing
      const baseMessages: AgentMessage[] = [
        { role: 'system', content: String((this as any).instructions) }
      ];
      const userHistory: AgentMessage[] =
        input.messages ?? [{ role: 'user', content: user_input } as AgentMessage];
      const messages: AgentMessage[] = [
        ...baseMessages,
        ...userHistory,
        { role: 'assistant', content: final_text }
      ];

      const result: AgentResult = {
        messages,
        final_text: String(final_text),
        stop_reason: 'end'
      };

      await this.afterRun(input, options, result);
      return result;
    } catch (err) {
      const http_err = this.normalizeError(err);

      const baseMessages: AgentMessage[] = [
        { role: 'system', content: String((this as any).instructions) }
      ];
      const userHistory: AgentMessage[] =
        input.messages ?? [{ role: 'user', content: input.prompt } as AgentMessage];
      const messages: AgentMessage[] = [
        ...baseMessages,
        ...userHistory,
        { role: 'assistant', content: `Error: ${http_err.message}` }
      ];

      const result: AgentResult = {
        messages,
        final_text: `Error: ${http_err.message}`,
        stop_reason: 'model_error'
      };
      return result;
    } finally {
      clear();
    }
  }
}
