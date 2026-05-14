import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
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
import { GenerateOptions, Usage } from '../types/ai_prompt.types.js';

const DEFAULT_MODEL = 'gpt-5.4-nano';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 3;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS_TEXT = 256;
const DEFAULT_MAX_TOKENS_STRUCTURED = 5000;
const SLOW_CALL_THRESHOLD_MS = 10000;

type ResolvedOptions = {
  model: string;
  timeout_ms: number;
  retries: number;
  temperature: number;
  max_tokens: number;
};

export class OpenAiAdapter implements GenAiAdapter {

  private readonly client: OpenAI;
  private readonly default_model: string;
  private readonly default_timeout_ms: number;
  private readonly default_retries: number;

  private constructor(client: OpenAI, default_model: string, default_timeout_ms: number, default_retries: number) {
    this.client = client;
    this.default_model = default_model;
    this.default_timeout_ms = default_timeout_ms;
    this.default_retries = default_retries;
  }

  static create(): OpenAiAdapter {
    const api_key = process.env.OPENAI_API_KEY;
    if (!api_key) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    const model = process.env.OPENAI_DEFAULT_MODEL ?? DEFAULT_MODEL;
    const timeout_ms = Number(process.env.OPENAI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const retries = Number(process.env.OPENAI_RETRIES) || DEFAULT_RETRIES;
    return new OpenAiAdapter(new OpenAI({ apiKey: api_key }), model, timeout_ms, retries);
  }

  @logExecTime({ threshold_in_ms: SLOW_CALL_THRESHOLD_MS })
  async generateText(req: AdapterTextRequest): Promise<AdapterTextResponse> {
    const resolved = this.resolveOptions(req.options, DEFAULT_MAX_TOKENS_TEXT);
    const resp = await this.callWithRetry(resolved, (signal) =>
      this.client.responses.create(
        {
          model: resolved.model,
          input: req.messages,
          max_output_tokens: resolved.max_tokens,
          temperature: resolved.temperature,
        },
        { signal }
      )
    );
    const text = OpenAiAdapter.extractText(resp) ?? '';
    return {
      text,
      model: resp.model,
      usage: OpenAiAdapter.toUsage(resp.usage),
    };
  }

  @logExecTime({ threshold_in_ms: SLOW_CALL_THRESHOLD_MS })
  async generateStructured<T>(req: AdapterStructuredRequest<T>): Promise<AdapterStructuredResponse<T>> {
    if (req.format.kind === 'zod') {
      return this.generateStructuredFromZod(req, req.format);
    }
    return this.generateStructuredFromJsonSchema(req, req.format);
  }

  private async generateStructuredFromZod<T>(
    req: AdapterStructuredRequest<T>,
    format: Extract<AdapterStructuredRequest<T>['format'], { kind: 'zod' }>
  ): Promise<AdapterStructuredResponse<T>> {
    const resolved = this.resolveOptions(req.options, DEFAULT_MAX_TOKENS_STRUCTURED);
    const resp = await this.callWithRetry(resolved, (signal) =>
      this.client.responses.parse(
        {
          model: resolved.model,
          input: req.messages,
          max_output_tokens: resolved.max_tokens,
          temperature: resolved.temperature,
          text: {
            format: zodTextFormat(format.schema, format.name),
          },
        },
        { signal }
      )
    );
    const parsed = resp.output_parsed;
    if (parsed === null || parsed === undefined) {
      throw new Error('OpenAI returned no parsed structured output');
    }
    return {
      data: parsed as T,
      model: resp.model,
      usage: OpenAiAdapter.toUsage(resp.usage),
    };
  }

  private async generateStructuredFromJsonSchema<T>(
    req: AdapterStructuredRequest<T>,
    format: Extract<AdapterStructuredRequest<T>['format'], { kind: 'json_schema' }>
  ): Promise<AdapterStructuredResponse<T>> {
    const resolved = this.resolveOptions(req.options, DEFAULT_MAX_TOKENS_STRUCTURED);
    const resp = await this.callWithRetry(resolved, (signal) =>
      this.client.responses.create(
        {
          model: resolved.model,
          input: req.messages,
          max_output_tokens: resolved.max_tokens,
          temperature: resolved.temperature,
          text: {
            format: {
              type: 'json_schema',
              name: format.name,
              schema: format.schema,
              strict: true,
            },
          },
        },
        { signal }
      )
    );
    const text = OpenAiAdapter.extractText(resp);
    if (!text) {
      throw new Error('OpenAI returned no text for structured output');
    }
    return {
      data: JSON.parse(text) as T,
      model: resp.model,
      usage: OpenAiAdapter.toUsage(resp.usage),
    };
  }

  private resolveOptions(opts: GenerateOptions | undefined, default_max_tokens: number): ResolvedOptions {
    return {
      model: opts?.model ?? this.default_model,
      timeout_ms: opts?.timeout_ms ?? this.default_timeout_ms,
      retries: opts?.retries ?? this.default_retries,
      temperature: opts?.temperature ?? DEFAULT_TEMPERATURE,
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
          'OpenAI call completed'
        );
        return result;
      } catch (err) {
        attempt++;
        if (attempt > resolved.retries) {
          logger.error({ err, attempt }, 'OpenAI call failed after retries');
          throw err;
        }
        logger.warn({ err, attempt }, 'OpenAI call attempt failed, retrying');
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private static extractText(resp: OpenAI.Responses.Response): string | null {
    if (!Array.isArray(resp.output)) return null;
    const parts: string[] = [];
    for (const item of resp.output) {
      if (!('content' in item) || !Array.isArray(item.content)) continue;
      for (const c of item.content) {
        if (c.type === 'output_text' && typeof c.text === 'string') {
          parts.push(c.text);
        }
      }
    }
    return parts.length ? parts.join('') : null;
  }

  private static toUsage(usage: { input_tokens?: number; output_tokens?: number } | undefined | null): Usage {
    return {
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
    };
  }
}
