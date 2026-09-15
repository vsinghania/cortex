import type { ConversationMessage } from '../../lib/agent.types';
import type { ChatTurn } from './assistant.types';

export class ConversationTurns {
  private static readonly NOTE_TITLE_MAX_CHARS = 80;
  private static readonly MARKDOWN_LEAD = /^[#>*\-\d.\s]+/;
  private static readonly INLINE_MARKDOWN = /[*_`]|\[c:[^\]]+\]/g;

  static fromMessages(messages: ConversationMessage[]): ChatTurn[] {
    return messages
      .filter((m): m is ConversationMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
      .map((m, index) => ({
        id: `${m.turn}-${m.role}-${index}`,
        role: m.role,
        text: ConversationTurns.contentToText(m.content),
        citations: m.citations,
        created_at: m.created_at,
      }))
      .filter((t) => t.text.trim() !== '');
  }

  /** A note title from an answer's first meaningful line, stripped of markdown. */
  static noteTitleFrom(text: string): string {
    const first_line = text
      .split('\n')
      .map((line) => line.replace(ConversationTurns.MARKDOWN_LEAD, '').replace(ConversationTurns.INLINE_MARKDOWN, '').trim())
      .find((line) => line.length > 0);
    if (!first_line) return 'Saved from assistant';
    return first_line.length > ConversationTurns.NOTE_TITLE_MAX_CHARS
      ? `${first_line.slice(0, ConversationTurns.NOTE_TITLE_MAX_CHARS - 1).trimEnd()}…`
      : first_line;
  }

  private static contentToText(parts: ConversationMessage['content']): string {
    return parts
      .map((p) => (p.type === 'text' ? p.text : p.type === 'json' ? JSON.stringify(p.data) : ''))
      .join('');
  }
}
