import { z } from 'zod';
import { Message, GenerateOptions, Usage } from '../types/ai_prompt.types.js';

export type AdapterTextRequest = {
  messages: Message[];
  options?: GenerateOptions;
};

export type AdapterTextResponse = {
  text: string;
  model: string;
  usage: Usage;
};

export type AdapterStructuredFormat<T> =
  | { kind: 'zod'; name: string; schema: z.ZodType<T> }
  | { kind: 'json_schema'; name: string; schema: Record<string, unknown> };

export type AdapterStructuredRequest<T> = {
  messages: Message[];
  format: AdapterStructuredFormat<T>;
  options?: GenerateOptions;
};

export type AdapterStructuredResponse<T> = {
  data: T;
  model: string;
  usage: Usage;
};

export interface GenAiAdapter {
  generateText(req: AdapterTextRequest): Promise<AdapterTextResponse>;
  generateStructured<T>(req: AdapterStructuredRequest<T>): Promise<AdapterStructuredResponse<T>>;
}
