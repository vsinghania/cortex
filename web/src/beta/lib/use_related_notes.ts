import { useEffect, useState } from 'react';
import { ApiClient } from '../../lib/api_client';
import type { Note } from '../../lib/note.types';

const MAX_TAGS_QUERIED = 3;
const PER_TAG_LIMIT = 5;
const MAX_RELATED = 4;

/** Notes sharing the most tags with this one. The API filters by all tags given, so each tag is its own query. */
export function useRelatedNotes(note: Pick<Note, 'id' | 'tags'> | null): Note[] {
  const [related, set_related] = useState<Note[]>([]);
  const note_id = note?.id;
  const tags_key = JSON.stringify((note?.tags ?? []).slice(0, MAX_TAGS_QUERIED));

  useEffect(() => {
    const tags = JSON.parse(tags_key) as string[];
    if (!note_id || tags.length === 0) {
      set_related([]);
      return;
    }
    let cancelled = false;

    async function load(self_id: string) {
      try {
        const results = await Promise.all(tags.map((tag) => ApiClient.listNotes({ tags: [tag], limit: PER_TAG_LIMIT })));
        if (cancelled) return;
        const overlap = new Map<string, { note: Note; shared: number }>();
        for (const res of results) {
          for (const candidate of res.items) {
            if (candidate.id === self_id) continue;
            const entry = overlap.get(candidate.id);
            overlap.set(candidate.id, { note: candidate, shared: (entry?.shared ?? 0) + 1 });
          }
        }
        const ranked = [...overlap.values()]
          .sort((a, b) => b.shared - a.shared || b.note.updated_at.localeCompare(a.note.updated_at))
          .slice(0, MAX_RELATED)
          .map((entry) => entry.note);
        set_related(ranked);
      } catch {
        // Related notes are a nicety; a failure just leaves the section empty.
        if (!cancelled) set_related([]);
      }
    }
    void load(note_id);
    return () => {
      cancelled = true;
    };
  }, [note_id, tags_key]);

  return related;
}
