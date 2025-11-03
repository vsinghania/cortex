import { ParsedResponse } from 'openai/resources/responses/responses.mjs';
import { PromptRequest, PromptOptions, PromptResponse, Role, PromptMessage, OutputContentType } from '../types/ai_prompt.types.js';
import { GenAiAdapter } from './genai_adapter.js';
import OpenAI from "openai";
import { zodTextFormat, } from "openai/helpers/zod";
import { logger } from "../../common/logger.js";
import { logExecTime } from '../../lib/decorators/logging_decorators.js';

export class OpenAiAdapter implements GenAiAdapter {
  private openai_client: OpenAI;
  private default_model: string;
  private default_timeout: number;
  private default_retries: number;

  constructor() {
    this.openai_client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.default_model = process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4o-mini';
    this.default_timeout = Number(process.env.OPENAI_TIMEOUT_MS) || 10000;
    this.default_retries = Number(process.env.OPENAI_RETRIES) || 3;
  }

  @logExecTime({threshold_in_ms: 10000})
  async generateText(prompt: PromptRequest, opts?: PromptOptions): Promise<PromptResponse> {
    const model = opts?.model ?? this.default_model;
    const timeout = opts?.timeout ?? this.default_timeout;
    const retries = opts?.retries ?? this.default_retries;
    logger.info({ method: 'generateText', model, timeout, retries }, 'Starting generateText');

    let input: PromptMessage[] = [prompt.latest_prompt];
    if (!prompt.last_response_id) {
      input = opts?.ignore_history
        ? (prompt.message_history?.filter((msg) => msg.role === Role.SYSTEM) || []).concat(input)
        : (prompt.message_history ?? []).concat(input);
    }

    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const resp = await this.openai_client.responses.create(
          {
            model,
            input,
            max_output_tokens: opts?.max_tokens ?? 256,
            temperature: opts?.temperature ?? 0.7,
            previous_response_id: prompt.last_response_id
          },
          { signal: controller.signal }
        );
        clearTimeout(timer);
        return this.transformTextResponse(resp, input);
      } catch (err) {
        clearTimeout(timer);
        attempt++;
        if (attempt > retries) {
          logger.error({ method: 'generateText', error: err, attempt }, 'generateText failed after retries');
          throw err;
        }
        logger.warn({ method: 'generateText', error: err, attempt }, 'generateText attempt failed, retrying');
      }
    }
  }

  @logExecTime({ threshold_in_ms: 10000 })
  async generateJsonOutput<T>(prompt: PromptRequest, opts?: PromptOptions): Promise<PromptResponse> {
    if (!prompt.output_schema) {
      throw new Error("Output schema is required for generateJsonOutput");
    }

    const model = opts?.model ?? this.default_model;
    const timeout = opts?.timeout ?? this.default_timeout;
    const retries = opts?.retries ?? this.default_retries;

    let input: PromptMessage[] = [prompt.latest_prompt];
    if (!prompt.last_response_id) {
      input = opts?.ignore_history
        ? (prompt.message_history?.filter((msg) => msg.role === Role.SYSTEM) || []).concat(input)
        : (prompt.message_history ?? []).concat(input);
    }

    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const resp = await this.openai_client.responses.parse(
          {
            model,
            input,
            max_output_tokens: opts?.max_tokens ?? 5000,
            temperature: opts?.temperature ?? 0.7,
            previous_response_id: prompt.last_response_id,
            text: {
              format: zodTextFormat(prompt.output_schema.schema, prompt.output_schema.name),
            },
          },
          { signal: controller.signal }
        );
        clearTimeout(timer);
        return this.transformJsonResponse(resp, input);
      } catch (err) {
        clearTimeout(timer);
        attempt++;
        if (attempt > retries) throw err;
      }
    }
  }

  private extractText(resp: OpenAI.Responses.Response): string | null {
    if (Array.isArray(resp.output)) {
      const parts: string[] = [];
      for (const item of resp.output) {
        if ("content" in item && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" && "text" in c && typeof c.text === "string") {
              parts.push(c.text);
            }
          }
        }
      }
      if (parts.length) return parts.join("");
    }
    return null;
  }

  private extractJsonResponse<T>(resp: ParsedResponse<T>): T | null {
    return resp.output_parsed;
  }

  private transformJsonResponse(
    openai_response: ParsedResponse<any>,
    prompt_input: PromptMessage[]): PromptResponse {
    const response_json = this.extractJsonResponse<any>(openai_response);
    return {
      response_json,
      content_type: OutputContentType.OutputJson,
      message_history: prompt_input.concat([{ role: Role.ASSISTANT, content: JSON.stringify(response_json) }]),
      usage: {
        prompt_tokens: openai_response.usage?.input_tokens ?? 0,
        response_tokens: openai_response.usage?.output_tokens ?? 0,
        total_tokens: (openai_response.usage?.input_tokens ?? 0) + (openai_response.usage?.output_tokens ?? 0)
      },
      model: openai_response.model,
      response_id: openai_response.id,
      conversation_id: undefined
    };
  }

  private transformTextResponse(
    openai_response: OpenAI.Responses.Response,
    prompt_input: PromptMessage[]): PromptResponse {
    const response_text = this.extractText(openai_response) ?? "";
    return {
      response_text,
      content_type: OutputContentType.OutputText,
      message_history: prompt_input.concat([{ role: Role.ASSISTANT, content: response_text }]),
      usage: {
        prompt_tokens: openai_response.usage?.input_tokens ?? 0,
        response_tokens: openai_response.usage?.output_tokens ?? 0,
        total_tokens: (openai_response.usage?.input_tokens ?? 0) + (openai_response.usage?.output_tokens ?? 0)
      },
      model: openai_response.model,
      response_id: openai_response.id,
      conversation_id: undefined
    };
  }
}
