import { z } from 'zod';

export enum Role {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

export const GenAiProviderSchema = z.enum(['openai', 'anthropic']);
export type GenAiProvider = z.infer<typeof GenAiProviderSchema>;

export const MessageSchema = z.object({
  role: z.enum([Role.SYSTEM, Role.USER, Role.ASSISTANT]),
  content: z.string().min(1),
});

export type Message = z.infer<typeof MessageSchema>;

export const GenerateOptionsSchema = z.object({
  model: z.string().min(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeout_ms: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional(),
});

export type GenerateOptions = z.infer<typeof GenerateOptionsSchema>;

export type Usage = {
  input_tokens: number;
  output_tokens: number;
};

export type GenerateTextRequest = {
  messages: Message[];
  provider?: GenAiProvider;
  options?: GenerateOptions;
};

export type GenerateTextResponse = {
  message: Message;
  model: string;
  usage: Usage;
};

export type StructuredSchemaSource =
  | { kind: 'registered'; name: string }
  | { kind: 'zod'; name: string; schema: z.ZodTypeAny }
  | { kind: 'json_schema'; name: string; schema: Record<string, unknown> };

export type GenerateStructuredRequest = {
  messages: Message[];
  schema: StructuredSchemaSource;
  provider?: GenAiProvider;
  options?: GenerateOptions;
};

export type GenerateStructuredResponse<T = unknown> = {
  data: T;
  model: string;
  usage: Usage;
};
