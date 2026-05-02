import {
  user as userMessage,
  assistant as assistantMessage,
  system as systemMessage,
  RunToolCallItem,
  RunToolCallOutputItem,
  type AgentInputItem,
} from '@openai/agents';
import { performance } from 'node:perf_hooks';
import type { PromptMessage } from '../../../ai_svc/types/ai_prompt.types.js';
import { Role } from '../../../ai_svc/types/ai_prompt.types.js';
import type {
  AgentUsage,
  ToolInvocation,
  ToolResult,
} from '../../types/agent.types.js';

export class OpenAiSdkUtils {
  private constructor() {}

  static toSdkInputItem(m: PromptMessage): AgentInputItem {
    switch (m.role) {
      case Role.USER:
        return userMessage(m.content);
      case Role.ASSISTANT:
        return assistantMessage(m.content);
      case Role.SYSTEM:
        return systemMessage(m.content);
    }
  }

  static toSdkInput(messages: PromptMessage[]): AgentInputItem[] {
    return messages.map(OpenAiSdkUtils.toSdkInputItem);
  }

  static serializeToolResult(result: ToolResult): string {
    if (result.kind === 'text') return result.text;
    if (result.kind === 'json') return JSON.stringify(result.data);
    return JSON.stringify({ error: result.message });
  }

  static parseToolArgs(raw_args: unknown): unknown {
    if (typeof raw_args !== 'string') return raw_args ?? null;
    try {
      return JSON.parse(raw_args);
    } catch {
      return raw_args;
    }
  }

  static coerceToolResult(output: unknown): ToolResult {
    if (typeof output === 'string') return { kind: 'text', text: output };
    if (output && typeof output === 'object') return { kind: 'json', data: output };
    return { kind: 'text', text: String(output ?? '') };
  }

  static extractFinalText(result: any): string {
    if (typeof result?.finalOutput === 'string') return result.finalOutput;
    if (result?.finalOutput != null) {
      try {
        return JSON.stringify(result.finalOutput);
      } catch {
        return String(result.finalOutput);
      }
    }
    return '';
  }

  static extractUsage(result: any): AgentUsage {
    const responses: any[] = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
    let prompt_tokens = 0;
    let response_tokens = 0;
    for (const r of responses) {
      const u = r?.usage;
      if (!u) continue;
      prompt_tokens += Number(u.inputTokens ?? u.input_tokens ?? 0);
      response_tokens += Number(u.outputTokens ?? u.output_tokens ?? 0);
    }
    return {
      prompt_tokens,
      response_tokens,
      total_tokens: prompt_tokens + response_tokens,
    };
  }

  static extractModelName(result: any): string | undefined {
    const responses: any[] = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
    for (const r of responses) {
      if (typeof r?.model === 'string') return r.model;
    }
    return undefined;
  }

  static extractToolInvocations(result: any): ToolInvocation[] {
    const items: any[] = Array.isArray(result?.newItems) ? result.newItems : [];
    const calls_by_id = new Map<
      string,
      { name: string; args: unknown; turn: number; ts: number }
    >();
    const invocations: ToolInvocation[] = [];

    let turn = 0;
    for (const item of items) {
      if (item instanceof RunToolCallItem) {
        turn += 1;
        const raw = item.rawItem as any;
        const call_id: string | undefined = raw?.callId ?? raw?.id;
        const name: string = raw?.name ?? 'unknown_tool';
        const args = OpenAiSdkUtils.parseToolArgs(raw?.arguments);
        if (call_id) {
          calls_by_id.set(call_id, { name, args, turn, ts: performance.now() });
        }
      } else if (item instanceof RunToolCallOutputItem) {
        const raw = item.rawItem as any;
        const call_id: string | undefined = raw?.callId ?? raw?.id;
        const matched = call_id ? calls_by_id.get(call_id) : undefined;
        const output = (item as any).output ?? raw?.output;
        invocations.push({
          tool_name: matched?.name ?? 'unknown_tool',
          arguments: matched?.args ?? null,
          result: OpenAiSdkUtils.coerceToolResult(output),
          duration_ms: matched ? Math.max(0, performance.now() - matched.ts) : 0,
          turn: matched?.turn ?? turn,
        });
      }
    }
    return invocations;
  }
}
