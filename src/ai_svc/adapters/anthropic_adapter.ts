import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import { performance } from 'node:perf_hooks';
import { logger } from '../../common/logger.js';
import { logExecTime } from '../../lib/decorators/logging_decorators.js';
import { Time } from '../../lib/time.js';
import {
  AdapterStructuredRequest,
  AdapterStructuredResponse,
  AdapterTextRequest,
  AdapterTextResponse,
  GenAiAdapter,
} from './genai_adapter.js';
import { GenerateOptions, Message, Role, Usage } from '../types/ai_prompt.types.js';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 3;
const DEFAULT_MAX_TOKENS_TEXT = 4096;
const DEFAULT_MAX_TOKENS_STRUCTURED = 16000;
const MAX_TEMPERATURE = 1;
const SLOW_CALL_THRESHOLD_MS = 10000;

type ResolvedOptions = {
  model: string;
  timeout_ms: number;
  retries: number;
  temperature?: number;
  max_tokens: number;
};

type StructuredOutputFormat<T> = Anthropic.JSONOutputFormat & {
  parse(content: string): T;
};

type AnthropicPrompt = {
  system?: string;
  messages: Anthropic.MessageParam[];
};

class AnthropicRefusalError extends Error {
  constructor(category: string | null | undefined) {
    super(`Anthropic refused the request${category ? ` (category: ${category})` : ''}`);
    this.name = 'AnthropicRefusalError';
  }
}

export class AnthropicAdapter implements GenAiAdapter {

  private readonly client: Anthropic;
  private readonly default_model: string;
  private readonly default_timeout_ms: number;
  private readonly default_retries: number;

  private constructor(client: Anthropic, default_model: string, default_timeout_ms: number, default_retries: number) {
    this.client = client;
    this.default_model = default_model;
    this.default_timeout_ms = default_timeout_ms;
    this.default_retries = default_retries;
  }

  static create(): AnthropicAdapter {
    const api_key = process.env.ANTHROPIC_API_KEY;
    if (!api_key) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    const model = process.env.ANTHROPIC_DEFAULT_MODEL ?? DEFAULT_MODEL;
    const timeout_ms = Number(process.env.ANTHROPIC_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const retries = Number(process.env.ANTHROPIC_RETRIES) || DEFAULT_RETRIES;
    // Retries are owned by callWithRetry so each attempt is logged and non-retryable errors short-circuit.
    const client = new Anthropic({ apiKey: api_key, maxRetries: 0 });
    return new AnthropicAdapter(client, model, timeout_ms, retries);
  }

  @logExecTime({ threshold_in_ms: SLOW_CALL_THRESHOLD_MS })
  async generateText(req: AdapterTextRequest): Promise<AdapterTextResponse> {
    const resolved = this.resolveOptions(req.options, DEFAULT_MAX_TOKENS_TEXT);
    const resp = await this.createMessage(req.messages, resolved);
    return {
      text: AnthropicAdapter.extractText(resp),
      model: resp.model,
      usage: AnthropicAdapter.toUsage(resp.usage),
    };
  }

  @logExecTime({ threshold_in_ms: SLOW_CALL_THRESHOLD_MS })
  async generateStructured<T>(req: AdapterStructuredRequest<T>): Promise<AdapterStructuredResponse<T>> {
    const output_format = AnthropicAdapter.toOutputFormat(req.format);
    return this.requestJson(req, output_format);
  }

  private async requestJson<T>(
    req: AdapterStructuredRequest<T>,
    output_format: StructuredOutputFormat<T>
  ): Promise<AdapterStructuredResponse<T>> {
    const resolved = this.resolveOptions(req.options, DEFAULT_MAX_TOKENS_STRUCTURED);
    const resp = await this.createMessage(req.messages, resolved, { format: output_format });
    if (resp.stop_reason === 'max_tokens') {
      throw new Error('Anthropic structured output was truncated at max_tokens');
    }
    const text = AnthropicAdapter.extractText(resp);
    if (!text) {
      throw new Error('Anthropic returned no text for structured output');
    }
    return {
      data: output_format.parse(text),
      model: resp.model,
      usage: AnthropicAdapter.toUsage(resp.usage),
    };
  }

  private async createMessage(
    messages: Message[],
    resolved: ResolvedOptions,
    output_config?: Anthropic.OutputConfig
  ): Promise<Anthropic.Message> {
    const prompt = AnthropicAdapter.toAnthropicPrompt(messages);
    const resp = await this.callWithRetry(resolved, (signal) =>
      this.client.messages.create(
        {
          model: resolved.model,
          max_tokens: resolved.max_tokens,
          messages: prompt.messages,
          ...(prompt.system !== undefined && { system: prompt.system }),
          ...(resolved.temperature !== undefined && { temperature: resolved.temperature }),
          ...(output_config && { output_config }),
        },
        { signal }
      )
    );
    if (resp.stop_reason === 'refusal') {
      throw new AnthropicRefusalError(resp.stop_details?.category);
    }
    return resp;
  }

  private resolveOptions(opts: GenerateOptions | undefined, default_max_tokens: number): ResolvedOptions {
    return {
      model: opts?.model ?? this.default_model,
      timeout_ms: opts?.timeout_ms ?? this.default_timeout_ms,
      retries: opts?.retries ?? this.default_retries,
      temperature: AnthropicAdapter.clampTemperature(opts?.temperature),
      max_tokens: opts?.max_tokens ?? default_max_tokens,
    };
  }

  private async callWithRetry<R>(
    resolved: ResolvedOptions,
    invoke: (signal: AbortSignal) => Promise<R>
  ): Promise<R> {
    const start_ms = performance.now();
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), resolved.timeout_ms);
      try {
        const result = await invoke(controller.signal);
        const duration_ms = Time.elapsedMs(start_ms);
        logger.info(
          { model: resolved.model, attempt: attempt + 1, duration_ms },
          'Anthropic call completed'
        );
        return result;
      } catch (err) {
        attempt++;
        if (!AnthropicAdapter.isRetryable(err) || attempt > resolved.retries) {
          logger.error({ err, attempt }, 'Anthropic call failed');
          throw err;
        }
        logger.warn({ err, attempt }, 'Anthropic call attempt failed, retrying');
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private static toOutputFormat<T>(format: AdapterStructuredRequest<T>['format']): StructuredOutputFormat<T> {
    if (format.kind === 'zod') {
      return zodOutputFormat(format.schema);
    }
    return {
      type: 'json_schema',
      schema: transformJSONSchema(format.schema),
      parse: (content) => JSON.parse(content) as T,
    };
  }

  private static isRetryable(err: unknown): boolean {
    return !(
      err instanceof Anthropic.BadRequestError ||
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError ||
      err instanceof Anthropic.NotFoundError
    );
  }

  private static toAnthropicPrompt(messages: Message[]): AnthropicPrompt {
    const system_parts: string[] = [];
    const conversation: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      if (m.role === Role.SYSTEM) {
        system_parts.push(m.content);
      } else {
        conversation.push({ role: m.role, content: m.content });
      }
    }
    return {
      system: system_parts.length ? system_parts.join('\n\n') : undefined,
      messages: conversation,
    };
  }

  private static clampTemperature(temperature: number | undefined): number | undefined {
    return temperature === undefined ? undefined : Math.min(temperature, MAX_TEMPERATURE);
  }

  private static extractText(resp: Anthropic.Message): string {
    const parts: string[] = [];
    for (const block of resp.content) {
      if (block.type === 'text') {
        parts.push(block.text);
      }
    }
    return parts.join('');
  }

  private static toUsage(usage: Anthropic.Usage): Usage {
    return {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
    };
  }
}
