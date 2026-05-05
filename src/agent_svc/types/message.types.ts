import { z } from 'zod';

export enum Role {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
  Tool = 'tool',
}

export const TextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const JsonPartSchema = z.object({
  type: z.literal('json'),
  data: z.unknown(),
});

export const ImagePartSchema = z.object({
  type: z.literal('image'),
  url: z.string().url(),
});

export const ContentPartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  JsonPartSchema,
  ImagePartSchema,
]);

export const ContentSchema = z.array(ContentPartSchema);

export const ToolCallSchema = z.object({
  tool_call_id: z.string().min(1),
  tool_name: z.string().min(1),
  arguments: z.unknown(),
});

export const SystemMessageSchema = z.object({
  role: z.literal(Role.System),
  content: ContentSchema,
});

export const UserMessageSchema = z.object({
  role: z.literal(Role.User),
  content: ContentSchema,
});

export const AssistantMessageSchema = z.object({
  role: z.literal(Role.Assistant),
  content: ContentSchema,
  tool_calls: z.array(ToolCallSchema).optional(),
  provider_response_id: z.string().optional(),
});

export const ToolMessageSchema = z.object({
  role: z.literal(Role.Tool),
  tool_call_id: z.string().min(1),
  content: ContentSchema,
});

export const MessageSchema = z.discriminatedUnion('role', [
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

export type ContentPart = z.infer<typeof ContentPartSchema>;
export type Content = ContentPart[];
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type SystemMessage = z.infer<typeof SystemMessageSchema>;
export type UserMessage = z.infer<typeof UserMessageSchema>;
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type ToolMessage = z.infer<typeof ToolMessageSchema>;
export type Message = z.infer<typeof MessageSchema>;

export type JsonPart<T> = { type: 'json'; data: T };

export class MessageContent {
  private constructor() {}

  static text(text: string): Content {
    return [{ type: 'text', text }];
  }

  static empty(): Content {
    return [];
  }

  static toText(content: Content): string {
    return content
      .map((part) => {
        if (part.type === 'text') return part.text;
        if (part.type === 'json') return MessageContent.stringifyJson(part.data);
        return part.url;
      })
      .join('');
  }

  private static stringifyJson(value: unknown): string {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return String(value);
    }
  }
}
