import type { NotePatchFields } from './repositories/note_repository_interface.js';

const ORGANIZATIONAL_KEYS: ReadonlySet<string> = new Set(['is_pinned', 'is_archived', 'folder_id']);

export class NotePatchKind {
  private constructor() {}

  /**
   * Chunks and vectors are derived from the body alone; titles are joined live at
   * retrieval, so a rename never needs re-embedding.
   */
  static changesNoteBody(patch: NotePatchFields): boolean {
    return patch.body !== undefined;
  }

  static changesArchiveState(patch: NotePatchFields): boolean {
    return patch.is_archived !== undefined;
  }

  /**
   * Pinning, archiving and filing are not edits to the note, so they must not bump
   * `updated_at` - otherwise the default date-sorted list reorders on every pin.
   */
  static isOrganizationalOnly(patch: NotePatchFields): boolean {
    const keys = Object.entries(patch)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    return keys.length > 0 && keys.every((key) => ORGANIZATIONAL_KEYS.has(key));
  }
}
