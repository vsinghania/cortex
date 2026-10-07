import { z } from 'zod';

const BaseUrlSchema = z.string().url();

/**
 * Links into the SPA for notes and the passages inside them. External assistants cite
 * these instead of Cortex's own `[c:…]` markers, which only Cortex chat understands.
 *
 * Must agree with `AppRoutes.note()` in web/src/lib/app_routes.ts and with the `chunk`
 * query parameter the notes page reads to highlight a passage.
 */
export class NoteLinks {
  private constructor(private readonly base_url: string) {}

  /** Null when APP_PUBLIC_URL is unset: tools then simply return no links. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): NoteLinks | null {
    const parsed = BaseUrlSchema.safeParse(env.APP_PUBLIC_URL);
    return parsed.success ? new NoteLinks(parsed.data) : null;
  }

  note(note_id: string): string {
    return new URL(`/notes/${encodeURIComponent(note_id)}`, this.base_url).toString();
  }

  chunk(note_id: string, chunk_id: string): string {
    const url = new URL(this.note(note_id));
    url.searchParams.set('chunk', chunk_id);
    return url.toString();
  }
}
