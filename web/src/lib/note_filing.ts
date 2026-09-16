import type { NoteFilingSuggestion } from './note.types';
import type { NoteFolderNode } from './note_folder.types';

export type FilingTarget = {
  title: string;
  folder_id: string | undefined;
  tags: string[];
};

/** What is left of a suggestion once anything the note already has is removed. */
export type PendingFiling = {
  title: string | null;
  folder: NoteFolderNode | null;
  tags: string[];
};

/** The parts of a suggestion the user chose to apply in one click. */
export type FilingChoice = {
  title?: string;
  folder_id?: string;
  tags?: string[];
};

export class NoteFiling {
  private constructor() {}

  /**
   * A title only counts while the note is still untitled, and a folder only while it still
   * exists, so the card never offers something that applying would silently undo or fail.
   */
  static pending(suggestion: NoteFilingSuggestion, target: FilingTarget, folders_by_id: Map<string, NoteFolderNode>): PendingFiling {
    const folder = suggestion.folder ? folders_by_id.get(suggestion.folder.id) ?? null : null;
    return {
      title: target.title.trim() ? null : suggestion.title,
      folder: folder && folder.id !== target.folder_id ? folder : null,
      tags: NoteFiling.missingTags(suggestion.tags, target.tags),
    };
  }

  static isEmpty(filing: PendingFiling | NoteFilingSuggestion): boolean {
    return !filing.title && !filing.folder && filing.tags.length === 0;
  }

  static everything(pending: PendingFiling): FilingChoice {
    return {
      title: pending.title ?? undefined,
      folder_id: pending.folder?.id,
      tags: pending.tags.length > 0 ? pending.tags : undefined,
    };
  }

  /** Tags compare case-insensitively, matching how the tag editor dedupes. */
  static withTags(current: string[], added: string[]): string[] {
    return [...current, ...NoteFiling.missingTags(added, current)];
  }

  private static missingTags(candidates: string[], current: string[]): string[] {
    const present = new Set(current.map((t) => t.toLowerCase()));
    return candidates.filter((t) => !present.has(t.toLowerCase()));
  }
}
