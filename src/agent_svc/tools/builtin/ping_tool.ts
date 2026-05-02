import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types/agent.types.js';

const PingArgsSchema = z.object({
  message: z.string().nullable().describe('Optional message to echo back; pass null if none'),
});

type PingArgs = z.infer<typeof PingArgsSchema>;

export class PingTool implements Tool<PingArgs> {
  readonly name = 'ping';
  readonly description =
    'Returns "pong" along with an optional echoed message. Useful for verifying tool execution.';
  readonly input_schema = PingArgsSchema;

  async execute(args: PingArgs, ctx: ToolContext): Promise<ToolResult> {
    const message = args.message ?? undefined;
    ctx.logger.info({ tool: this.name, message }, 'ping tool invoked');
    return { kind: 'text', text: message ? `pong: ${message}` : 'pong' };
  }
}
