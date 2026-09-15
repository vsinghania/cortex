import type { NotePatchFields } from './repositories/note_repository_interface.js';

const ORGANIZATIONAL_KEYS: ReadonlySet<string> = new Set(['is_pinned', 'is_archived']);

export class NotePatchKind {
  private constructor() {}

  static touchesBody(patch: NotePatchFields): boolean {
    return patch.body !== undefined || patch.title !== undefined;
  }

  static touchesArchive(patch: NotePatchFields): boolean {
    return patch.is_archived !== undefined;
  }

  /**
   * Pinning and archiving are not edits to the note, so they must not bump
   * `updated_at` - otherwise the default date-sorted list reorders on every pin.
   */
  static isOrganizationalOnly(patch: NotePatchFields): boolean {
    const keys = Object.entries(patch)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    return keys.length > 0 && keys.every((key) => ORGANIZATIONAL_KEYS.has(key));
  }
}
