import { z } from 'zod';
import { AiSvc } from '../../ai_svc/ai_svc.js';
import { Role as AiRole } from '../../ai_svc/types/ai_prompt.types.js';
import type { NoteFolderNode } from '../types/note_folder.types.js';
import type { NoteTagCount } from '../repositories/note_repository_interface.js';
import { NoteFolderTree } from '../note_folder_tree.js';

export type NoteFilingInput = {
  title?: string;
  body: string;
  folders: NoteFolderNode[];
  tags: NoteTagCount[];
};

export type NoteFilingSuggestion = {
  /** Only suggested when the note has no title yet. */
  title: string | null;
  folder: { id: string; path: string[] } | null;
  tags: string[];
};

export type NoteFilingRawSuggestion = z.infer<typeof NoteFilingSuggester.OUTPUT_SCHEMA>;

export class NoteFilingSuggester {
  static readonly MAX_BODY_CHARS = 4000;
  static readonly MAX_FOLDERS = 300;
  static readonly MAX_EXISTING_TAGS = 100;
  static readonly MAX_SUGGESTED_TAGS = 5;
  static readonly MAX_TITLE_CHARS = 120;

  private static readonly MAX_OUTPUT_TOKENS = 200;

  static readonly OUTPUT_SCHEMA = z.object({
    title: z.string().nullable(),
    folder_id: z.string().nullable(),
    tags: z.array(z.string())
  });

  private static readonly SYSTEM_PROMPT =
    'You help file a personal note. Reply with JSON only.\n' +
    '- folder_id: the id of the single best existing folder from the list, or null when none clearly fits. ' +
    'Never invent an id.\n' +
    `- tags: up to ${NoteFilingSuggester.MAX_SUGGESTED_TAGS} short topical tags. Strongly prefer tags from the ` +
    'existing list; add a new tag only when no existing tag covers an important topic. Return [] if unsure.\n' +
    '- title: when the note has no title, a concise 3 to 8 word title in the note\'s language; otherwise null.';

  private constructor() {}

  static async suggest(input: NoteFilingInput): Promise<{ suggestion: NoteFilingSuggestion; model: string }> {
    const ai_svc = await AiSvc.getInstance();
    const { data, model } = await ai_svc.generateStructured<NoteFilingRawSuggestion>({
      messages: [
        { role: AiRole.SYSTEM, content: NoteFilingSuggester.SYSTEM_PROMPT },
        { role: AiRole.USER, content: NoteFilingSuggester.buildUserPrompt(input) }
      ],
      schema: {
        kind: 'zod',
        name: 'note_filing_suggestion',
        schema: NoteFilingSuggester.OUTPUT_SCHEMA
      },
      options: { max_tokens: NoteFilingSuggester.MAX_OUTPUT_TOKENS }
    });
    return { suggestion: NoteFilingSuggester.sanitize(data, input), model };
  }

  static hasTitle(title: string | undefined): boolean {
    return !!title && title.trim().length > 0;
  }

  /**
   * The model's output is untrusted: unknown folder ids are dropped, tags are deduped
   * (folding case) and snapped to an existing tag's spelling, and a title is only kept
   * when the note did not already have one.
   */
  static sanitize(raw: NoteFilingRawSuggestion, input: Pick<NoteFilingInput, 'title' | 'folders' | 'tags'>): NoteFilingSuggestion {
    const folder = raw.folder_id ? input.folders.find((f) => f.id === raw.folder_id) : undefined;
    return {
      title: NoteFilingSuggester.hasTitle(input.title) ? null : NoteFilingSuggester.sanitizeTitle(raw.title),
      folder: folder ? { id: folder.id, path: folder.path } : null,
      tags: NoteFilingSuggester.sanitizeTags(raw.tags, input.tags)
    };
  }

  private static sanitizeTitle(title: string | null): string | null {
    const trimmed = (title ?? '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return null;
    return trimmed.slice(0, NoteFilingSuggester.MAX_TITLE_CHARS).trimEnd();
  }

  private static sanitizeTags(tags: string[], existing: NoteTagCount[]): string[] {
    const existing_by_folded = new Map(existing.map((t) => [t.tag.toLowerCase(), t.tag]));
    const out = new Map<string, string>();
    for (const raw of tags) {
      const tag = raw.trim();
      if (!tag) continue;
      const folded = tag.toLowerCase();
      if (!out.has(folded)) out.set(folded, existing_by_folded.get(folded) ?? tag);
      if (out.size >= NoteFilingSuggester.MAX_SUGGESTED_TAGS) break;
    }
    return Array.from(out.values());
  }

  private static buildUserPrompt(input: NoteFilingInput): string {
    const folders = input.folders
      .slice(0, NoteFilingSuggester.MAX_FOLDERS)
      .map((f) => `${f.id}\t${f.path.join(NoteFolderTree.PATH_SEPARATOR)}`)
      .join('\n');
    const tags = input.tags
      .slice(0, NoteFilingSuggester.MAX_EXISTING_TAGS)
      .map((t) => t.tag)
      .join(', ');
    const title = NoteFilingSuggester.hasTitle(input.title) ? input.title!.trim() : '(none)';
    const body = input.body.slice(0, NoteFilingSuggester.MAX_BODY_CHARS);
    return [
      `Existing folders (id<TAB>path):\n${folders || '(none)'}`,
      `Existing tags: ${tags || '(none)'}`,
      `Note title: ${title}`,
      `Note body:\n${body || '(empty)'}`
    ].join('\n\n');
  }
}
