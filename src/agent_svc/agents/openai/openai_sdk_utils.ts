import {
  RunToolCallItem,
  RunToolCallOutputItem,
  RunMessageOutputItem,
  type AgentInputItem,
} from '@openai/agents';
import type {
  AgentUsage,
  ToolResult,
} from '../../types/agent.types.js';
import {
  Role,
  MessageContent,
  type Content,
  type ContentPart,
  type Message,
  type ToolCall,
} from '../../types/message.types.js';

export class OpenAiSdkUtils {
  private constructor() {}

  static toSdkInput(messages: Message[]): AgentInputItem[] {
    const items: AgentInputItem[] = [];
    for (const m of messages) {
      OpenAiSdkUtils.appendMessageItems(m, items);
    }
    return items;
  }

  private static appendMessageItems(m: Message, out: AgentInputItem[]): void {
    switch (m.role) {
      case Role.System:
        out.push({
          type: 'message',
          role: 'system',
          content: OpenAiSdkUtils.contentToText(m.content),
        } as AgentInputItem);
        return;
      case Role.User:
        out.push({
          type: 'message',
          role: 'user',
          content: OpenAiSdkUtils.toUserContent(m.content),
        } as AgentInputItem);
        return;
      case Role.Assistant: {
        const text = OpenAiSdkUtils.contentToText(m.content);
        if (text.length > 0) {
          out.push({
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text }],
          } as AgentInputItem);
        }
        for (const call of m.tool_calls ?? []) {
          out.push({
            type: 'function_call',
            callId: call.tool_call_id,
            name: call.tool_name,
            arguments: OpenAiSdkUtils.stringifyArgs(call.arguments),
          } as AgentInputItem);
        }
        return;
      }
      case Role.Tool:
        out.push({
          type: 'function_call_result',
          callId: m.tool_call_id,
          name: '',
          status: 'completed',
          output: {
            type: 'text',
            text: OpenAiSdkUtils.contentToText(m.content),
          },
        } as AgentInputItem);
        return;
    }
  }

  private static toUserContent(content: Content): unknown[] {
    return content.map((part) => OpenAiSdkUtils.toUserContentPart(part));
  }

  private static toUserContentPart(part: ContentPart): unknown {
    if (part.type === 'text') return { type: 'input_text', text: part.text };
    if (part.type === 'image') return { type: 'input_image', image: part.url };
    return { type: 'input_text', text: OpenAiSdkUtils.stringifyJson(part.data) };
  }

  static contentToText(content: Content): string {
    return MessageContent.toText(content);
  }

  static serializeToolResult(result: ToolResult): string {
    if (result.kind === 'text') return result.text;
    if (result.kind === 'json') return OpenAiSdkUtils.stringifyJson(result.data);
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

  static extractMessages(result: any): Message[] {
    const items: any[] = Array.isArray(result?.newItems) ? result.newItems : [];
    const messages: Message[] = [];

    for (const item of items) {
      if (item instanceof RunMessageOutputItem) {
        messages.push({
          role: Role.Assistant,
          content: MessageContent.text(OpenAiSdkUtils.assistantTextFromRawItem(item.rawItem)),
        });
      } else if (item instanceof RunToolCallItem) {
        const raw = item.rawItem as any;
        const tool_call: ToolCall = {
          tool_call_id: raw?.callId ?? raw?.id ?? '',
          tool_name: raw?.name ?? 'unknown_tool',
          arguments: OpenAiSdkUtils.parseToolArgs(raw?.arguments),
        };
        messages.push({
          role: Role.Assistant,
          content: MessageContent.empty(),
          tool_calls: [tool_call],
        });
      } else if (item instanceof RunToolCallOutputItem) {
        const raw = item.rawItem as any;
        const call_id: string = raw?.callId ?? raw?.id ?? '';
        const output_text = OpenAiSdkUtils.outputToText((item as any).output ?? raw?.output);
        messages.push({
          role: Role.Tool,
          tool_call_id: call_id,
          content: MessageContent.text(output_text),
        });
      }
    }

    OpenAiSdkUtils.stampLastAssistantResponseId(messages, result?.lastResponseId);
    return messages;
  }

  /**
   * Attaches the provider's response id to the last assistant message in the
   * extracted batch. Approximates per-message attribution using the run's
   * lastResponseId; finer-grained mapping would require walking rawResponses
   * and is deferred until needed.
   */
  private static stampLastAssistantResponseId(messages: Message[], response_id: unknown): void {
    if (typeof response_id !== 'string' || !response_id) return;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === Role.Assistant) {
        m.provider_response_id = response_id;
        return;
      }
    }
  }

  static extractFinalText(result: any): string {
    if (typeof result?.finalOutput === 'string') return result.finalOutput;
    if (result?.finalOutput != null) {
      return OpenAiSdkUtils.stringifyJson(result.finalOutput);
    }
    return '';
  }

  static extractFinalJson(result: any): unknown | undefined {
    const final = result?.finalOutput;
    if (final == null || typeof final === 'string') return undefined;
    if (typeof final !== 'object') return undefined;
    return final;
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

  private static assistantTextFromRawItem(raw: any): string {
    const parts: any[] = Array.isArray(raw?.content) ? raw.content : [];
    return parts
      .map((p) => {
        if (p?.type === 'output_text') return typeof p.text === 'string' ? p.text : '';
        if (p?.type === 'refusal') return typeof p.refusal === 'string' ? p.refusal : '';
        return '';
      })
      .join('');
  }

  private static outputToText(output: unknown): string {
    if (output == null) return '';
    if (typeof output === 'string') return output;
    if (typeof output === 'object' && 'type' in (output as any)) {
      const o = output as any;
      if (o.type === 'text' && typeof o.text === 'string') return o.text;
    }
    return OpenAiSdkUtils.stringifyJson(output);
  }

  private static stringifyArgs(args: unknown): string {
    if (typeof args === 'string') return args;
    return OpenAiSdkUtils.stringifyJson(args);
  }

  private static stringifyJson(value: unknown): string {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return String(value);
    }
  }
}
