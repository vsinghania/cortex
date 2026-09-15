import { ApiClient } from '../../lib/api_client';
import type { Note, NoteBulkAction, NoteBulkResult } from '../../lib/note.types';
import { Plural } from './plural';

export class NoteBulk {
  /** Mirrors NoteBulkActionMapper.MAX_IDS on the server. */
  static readonly MAX_IDS_PER_REQUEST = 100;

  private constructor() {}

  /**
   * Sends the selection in server-sized batches, one after another, and sums the results.
   * A failed batch throws and leaves earlier batches applied, so callers refresh either way.
   */
  static async apply(ids: string[], action: NoteBulkAction): Promise<NoteBulkResult> {
    const total: NoteBulkResult = { action: action.action, matched: 0, modified: 0 };
    for (const batch of NoteBulk.batches(ids)) {
      const result = await ApiClient.bulkUpdateNotes(batch, action);
      total.matched += result.matched;
      total.modified += result.modified;
    }
    return total;
  }

  static summary(action: NoteBulkAction, count: number): string {
    const notes = Plural.count(count, 'note');
    switch (action.action) {
      case 'move':
        return action.folder_id ? `Moved ${notes}.` : `Moved ${notes} to Unfiled.`;
      case 'archive':
        return `Archived ${notes}.`;
      case 'unarchive':
        return `Restored ${notes} from the archive.`;
      case 'pin':
        return `Pinned ${notes}.`;
      case 'unpin':
        return `Unpinned ${notes}.`;
      case 'add_tags':
        return `Tagged ${notes} #${action.tags.join(', #')}.`;
      case 'remove_tags':
        return `Removed #${action.tags.join(', #')} from ${notes}.`;
      case 'delete':
        return `Deleted ${notes}.`;
    }
  }

  /** Tags carried by any selected note, most common first, for the "remove tag" choices. */
  static tagsIn(notes: Note[]): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  private static batches(ids: string[]): string[][] {
    const unique = [...new Set(ids)];
    const out: string[][] = [];
    for (let i = 0; i < unique.length; i += NoteBulk.MAX_IDS_PER_REQUEST) {
      out.push(unique.slice(i, i + NoteBulk.MAX_IDS_PER_REQUEST));
    }
    return out;
  }
}
