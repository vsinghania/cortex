import { z } from 'zod';

export enum Role {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant'
}

export enum OutputContentType {
  OutputText = 'output_text',
  OutputJson = 'output_json'
}

export enum InputContentType {
  InputText = 'input_text',
  InputJson = 'input_json'
}

// export const ContentSchema = z.union([
//   z.string().optional(),
//   z.array(z.object({type: z.enum(), text: z.string().optional(), json: z.any().optional()}))
// ])

export const PromptMessageTypeSchema = z.object({
  role: z.enum([Role.SYSTEM, Role.USER, Role.ASSISTANT]),
  content: z.string().min(1)
});

export const PromptOptionsTypeSchema = z.object({
  max_tokens: z.number().min(1).optional(),
  temperature: z.number().min(0).max(1).optional(),
  model: z.string().optional(),
  ignore_history: z.boolean().optional(),
  timeout: z.number().positive().optional(),
  retries: z.number().min(0).optional()
});

export const PromptOutputSchema = z.object({
  name: z.string().min(1),
  schema: z.instanceof(z.ZodType)
})

export const PromptRequestTypeSchema = z.object({
  latest_prompt: PromptMessageTypeSchema,
  message_history: z.array(PromptMessageTypeSchema).optional(),
  last_response_id: z.string().optional(),
  conversation_id: z.string().optional(),
  options: PromptOptionsTypeSchema.optional(),
  output_schema: PromptOutputSchema.optional()
});

export const PromptResponseTypeSchema = z.object({
  response_text: z.string().optional(),
  response_json: z.any().optional(),
  content_type: z.enum([OutputContentType.OutputText, OutputContentType.OutputJson]),
  message_history: z.array(PromptMessageTypeSchema),
  usage: z.object({
    prompt_tokens: z.number().min(0),
    response_tokens: z.number().min(0),
    total_tokens: z.number().min(0)
  }),
  model: z.string().optional(),
  response_id: z.string().optional(),
  conversation_id: z.string().optional()
});

export type PromptRequest = z.infer<typeof PromptRequestTypeSchema>;

export type PromptMessage = z.infer<typeof PromptMessageTypeSchema>;

export type PromptOptions = z.infer<typeof PromptOptionsTypeSchema>;

export type PromptResponse = z.infer<typeof PromptResponseTypeSchema>;
