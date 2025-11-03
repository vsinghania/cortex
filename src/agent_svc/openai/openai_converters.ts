import { tool as sdkTool, MCPServerStdio } from '@openai/agents';
import type { AgentTool, ToolResult, ToolContext } from '../types/tool.types.js';
import type { McpConfig } from '../../mcp/client/types/mcp_config.types.js';

/**
 * Convert our in-process AgentTool into an OpenAI Agents SDK function tool.
 * - Uses our Zod schema directly for parameters
 * - Bridges the Agents SDK RunContext into our ToolContext
 * - Normalizes ToolResult to a string payload
 */
export function toSdkFunctionTool(t: AgentTool) {
  return sdkTool({
    name: t.name,
    description: t.description ?? '',
    parameters: t.parameters as any,
    // sdk execute signature: (args: any, runContext?: RunContext) => string | Promise<string>
    execute: async (args: unknown, runContext?: unknown) => {
      // Build our ToolContext from the SDK run context
      const rc: any = runContext as any;
      const ctx: ToolContext = {
        user_id: rc?.context?.user_id,
        logger: rc?.context?.logger,
        abort_signal: rc?.signal,
        metadata: rc?.context?.metadata
      };

      // Our handler returns ToolResult<C> where C is string | object
      const result = await t.handler(args as any, ctx);
      return flattenToolResult(result);
    }
  });
}

/**
 * Normalize our ToolResult into a string for the model.
 * - Strings are returned as-is
 * - Objects are JSON-stringified
 * - If messages are present, include them in a wrapper JSON payload
 */
export function flattenToolResult(result: ToolResult): string {
  const { content, messages } = result ?? {};
  if (typeof content === 'string' && !messages) {
    return content;
  }
  try {
    return JSON.stringify({
      content,
      messages
    });
  } catch {
    return String(content);
  }
}

/**
 * Build and connect one or more MCP stdio servers from our validated config.
 * Only `transport: "stdio"` is supported per current requirement.
 */
export async function buildMcpServersFromConfig(configs: McpConfig | McpConfig[]): Promise<MCPServerStdio[]> {
  const arr = Array.isArray(configs) ? configs : [configs];
  const servers: MCPServerStdio[] = [];

  for (const cfg of arr) {
    if (cfg.transport !== 'stdio' || !cfg.stdio) {
      throw new Error('Only stdio MCP transport is supported for now.');
    }

    const { command, args = [], env, cwd, startup_timeout_ms } = cfg.stdio;

    // Prefer fullCommand; fall back to discrete fields if supported by SDK at runtime.
    const fullCommand = [command, ...args.map(quoteIfNeeded)].join(' ');

    // Typing for constructor options isn&#39;t exported; cast to any to pass optional fields.
    const server = new MCPServerStdio({
      // Agents SDK examples show fullCommand
      fullCommand,
      // Pass-through environment/cwd when available
      env,
      cwd
    } as any);

    // Connect with an optional startup timeout
    if (startup_timeout_ms && startup_timeout_ms > 0) {
      await withTimeout(server.connect(), startup_timeout_ms, `MCP server startup timed out: ${fullCommand}`);
    } else {
      await server.connect();
    }

    servers.push(server);
  }

  return servers;
}

function quoteIfNeeded(s: string): string {
  // Basic quoting for args containing whitespace or quotes
  if (/[\s"\&#39;]/.test(s)) {
    // escape quotes
    const escaped = s.replace(/"/g, '\"').replace(/&#39;/g, '\\&#39;');
    return `"${escaped}"`;
  }
  return s;
}

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeoutMsg?: string): Promise<T> {
  let to: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        to = setTimeout(() => reject(new Error(onTimeoutMsg ?? `Operation timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (to) clearTimeout(to);
  }
}
