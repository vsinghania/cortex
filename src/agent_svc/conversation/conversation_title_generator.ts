import { z } from 'zod';
import { AiSvc } from '../../ai_svc/ai_svc.js';
import { Role as AiRole } from '../../ai_svc/types/ai_prompt.types.js';
import { Role, type Message, MessageContent } from '../types/message.types.js';

const MAX_QUERY_CHARS = 2000;
const TITLE_MAX_TOKENS = 32;

const TitleSchema = z.object({
  title: z.string().min(1).max(80),
});

const SYSTEM_PROMPT =
  'Produce a concise 3 to 6 word title that summarizes the user message. ' +
  'Use Title Case. Do not wrap in quotes. Do not end with a period.';

export class ConversationTitleGenerator {
  private constructor() {}

  static async generate(query: string): Promise<string> {
    const ai_svc = await AiSvc.getInstance();
    const { data } = await ai_svc.generateStructured<{ title: string }>({
      messages: [
        { role: AiRole.SYSTEM, content: SYSTEM_PROMPT },
        { role: AiRole.USER, content: query },
      ],
      schema: {
        kind: 'zod',
        name: 'conversation_title',
        schema: TitleSchema,
      },
      options: { max_tokens: TITLE_MAX_TOKENS },
    });
    return data.title.trim();
  }

  static extractQuery(input: string | Message[]): string | null {
    if (typeof input === 'string') {
      return ConversationTitleGenerator.normalize(input);
    }
    const first_user = input.find((m): m is Message & { role: Role.User } => m.role === Role.User);
    if (!first_user) return null;
    return ConversationTitleGenerator.normalize(MessageContent.toText(first_user.content));
  }

  private static normalize(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    return trimmed.length > MAX_QUERY_CHARS ? trimmed.slice(0, MAX_QUERY_CHARS) : trimmed;
  }
}
