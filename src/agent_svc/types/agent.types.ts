import type { ToolResult } from "./tool.types.js";

export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

export type AgentInput = {
  user_id?: string;
  prompt: string;
  context?: Record<string, unknown>;
  messages?: AgentMessage[];
};

export type AgentRunOptions = {
  max_steps?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
  timeout_ms?: number;
};



export type AgentEvent =
  | { type: "step_started"; step: number }
  | { type: "tool_called"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: ToolResult<unknown> }
  | { type: "message"; message: AgentMessage }
  | { type: "step_completed"; step: number }
  | { type: "error"; error: { message: string } };

export type AgentResult = {
  messages: AgentMessage[];
  final_text: string;
  stop_reason?: "end" | "max_steps" | "tool_error" | "model_error";
  usage?: { input_tokens?: number; output_tokens?: number };
};
