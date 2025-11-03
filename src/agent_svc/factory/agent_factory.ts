import { agent_config_schema, type AgentConfig } from "../types/agent_config.types.js";
import type { Agent } from "../interfaces/agent_interface.js";
import type { AgentTool } from "../types/tool.types.js";
import type { AgentInput, AgentRunOptions, AgentResult } from "../types/agent.types.js";
import { OpenAiAgent } from "../openai/openai_agent.js";
import { toolRegistry } from "../registry/tool_registry.js";
import { agentRegistry } from "../registry/agent_registry.js";

/**
 * Agent Factory (provider-agnostic public API, OpenAI-backed for now)
 *
 * Validates config at the boundary (Zod), constructs a concrete Agent instance,
 * registers tools and agent handoffs, and returns both the agent and a run helper.
 *
 * Notes:
 * - Provider support is defaulted to OpenAI for now.
 * - MCP configs are injected into run() via options.metadata.mcp_configs.
 * - default_model is currently a hint; our OpenAiAgent reads model from env. We attach it
 *   into metadata for future use without breaking API (no-op today).
 */


export function createAgentFromUntrusted(raw: unknown) {
  const cfg = agent_config_schema.parse(raw);
  return createAgentFromConfig(cfg);
}

export function createAgentFromConfig(cfg: AgentConfig): {
  agent: Agent;
  run: (input: AgentInput, overrides?: AgentRunOptions) => Promise<AgentResult>;
} {
  // 1) Instantiate provider-backed agent (only 'openai' is supported for now)
  const agent = buildProviderAgent(cfg);

  // 2) Resolve tools from global registry and register on agent (throw during build)
  {
    const allRegistered = new Set(toolRegistry.listNames());
    if (cfg.tools && cfg.tools.length > 0) {
      const missing = cfg.tools.filter((n) => !allRegistered.has(n));
      if (missing.length) {
        throw new Error(`agent_factory: requested tools not registered: ${missing.join(", ")}`);
      }
    }
    const resolvedTools: AgentTool[] =
      cfg.tools && cfg.tools.length > 0
        ? (cfg.tools.map((n) => toolRegistry.get(n)!).filter(Boolean) as AgentTool[])
        : toolRegistry.list();
    agent.registerTools(resolvedTools);
  }

  // 3) Register tool agents and handoff agents
  if (cfg.tool_agents?.length) {
    const unresolvedTA: string[] = [];
    for (const name of cfg.tool_agents) {
      const a = agentRegistry.get(name);
      if (!a) { unresolvedTA.push(name); } else { agent.registerToolAgent(name, a); }
    }
    if (unresolvedTA.length) {
      throw new Error(`agent_factory: unresolved tool agent names: ${unresolvedTA.join(", ")}`);
    }
  }

  if (cfg.handoff_agents?.length) {
    const unresolvedHA: string[] = [];
    for (const name of cfg.handoff_agents) {
      const a = agentRegistry.get(name);
      if (!a) { unresolvedHA.push(name); } else { agent.registerHandoffAgent(name, a); }
    }
    if (unresolvedHA.length) {
      throw new Error(`agent_factory: unresolved handoff agent names: ${unresolvedHA.join(", ")}`);
    }
  }

  // 4) Provide a run helper that merges default_run_options with overrides and injects MCP configs
  const run = async (input: AgentInput, overrides?: AgentRunOptions) => {
    const merged = mergeRunOptions(cfg.default_run_options, overrides, cfg);
    return agent.run(input, merged);
  };

  return { agent, run };
}

/**
 * Create the concrete provider-backed Agent instance from config.
 * Currently defaults to OpenAI provider.
 */
function buildProviderAgent(cfg: AgentConfig): Agent {
  switch (cfg.provider ?? "openai") {
    case "openai":
    default: {
      const agent = new OpenAiAgent(cfg.name, cfg.instructions);
      return agent;
    }
  }
}

/**
 * Merge default and override run options. Also inject:
 * - metadata.mcp_configs: prefer overrides -> defaults -> cfg.mcp_configs
 * - metadata.default_model: attach cfg.default_model as a hint (no-op unless provider uses it)
 */
function mergeRunOptions(
  defaults: AgentRunOptions | undefined,
  overrides: AgentRunOptions | undefined,
  cfg: AgentConfig
): AgentRunOptions {
  const out: AgentRunOptions = {
    ...(defaults ?? {}),
    ...(overrides ?? {})
  };

  // metadata shallow merge
  const mergedMeta: Record<string, unknown> = {
    ...(defaults?.metadata ?? {}),
    ...(overrides?.metadata ?? {})
  };

  // Inject MCP configs if caller didn't supply them
  if (!("mcp_configs" in (mergedMeta ?? {}))) {
    if (overrides?.metadata && "mcp_configs" in overrides.metadata) {
      // already covered by shallow merge above
    } else if (defaults?.metadata && "mcp_configs" in defaults.metadata) {
      // already covered by shallow merge above
    } else if (cfg.mcp_configs && cfg.mcp_configs.length > 0) {
      mergedMeta["mcp_configs"] = cfg.mcp_configs;
    }
  }

  // Attach default_model as a hint for future provider use
  if (cfg.default_model && !("default_model" in mergedMeta)) {
    mergedMeta["default_model"] = cfg.default_model;
  }

  if (Object.keys(mergedMeta).length > 0) {
    out.metadata = mergedMeta;
  }

  return out;
}

/**
 * Example usage:
 *
 * import { createAgentFromConfig } from "./agent_factory";
 * import { agent_config_schema } from "../types/agent_config.types";
 *
 * const cfg = agent_config_schema.parse({
 *   name: "Notes assistant",
 *   instructions: "Help with notes.",
 *   provider: "openai",
 *   tools: ["summarize"],
 *   mcp_configs: [MCP_CONFIGS],
 *   default_run_options: { temperature: 0.2, timeout_ms: 15000 }
 * });
 *
 * // Tools must be registered globally during app startup:
 * // toolRegistry.register(summarizeTool.name, summarizeTool)
 *
 * const { agent, run } = createAgentFromConfig(cfg);
 *
 * const res = await run({ prompt: "Summarize latest notes" });
 * console.log(res.final_text);
 */
