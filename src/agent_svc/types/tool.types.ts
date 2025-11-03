import { z, type ZodTypeAny } from "zod";
import type { logger as appLogger } from "../../common/logger.js";
import type { AgentMessage } from "./agent.types.js";

export type ToolContext = {
  user_id?: string;
  logger?: typeof appLogger;
  abort_signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type ToolResult<C = string | Record<string, unknown>> = {
  content: C;
  messages?: AgentMessage[];
};

export interface AgentTool<P extends ZodTypeAny = ZodTypeAny, C = string | Record<string, unknown>> {
  name: string;
  description?: string;
  parameters?: P;
  handler(args: z.infer<P>, ctx: ToolContext): Promise<ToolResult<C>>;
}
