import type { NoteBulkAction } from './types/note_bulk.types.js';
import type { NoteBulkUpdate } from './repositories/note_repository_interface.js';

export class NoteBulkActionMapper {
  static readonly MAX_IDS = 100;

  private constructor() {}

  /** `delete` has no update form: it goes through the trash-snapshotting delete path instead. */
  static toRepositoryBulkUpdate(action: Exclude<NoteBulkAction, { action: 'delete' }>): NoteBulkUpdate {
    switch (action.action) {
      case 'move':
        return { kind: 'organize', fields: { folder_id: action.folder_id } };
      case 'archive':
        return { kind: 'organize', fields: { is_archived: true } };
      case 'unarchive':
        return { kind: 'organize', fields: { is_archived: false } };
      case 'pin':
        return { kind: 'organize', fields: { is_pinned: true } };
      case 'unpin':
        return { kind: 'organize', fields: { is_pinned: false } };
      case 'add_tags':
        return { kind: 'add_tags', tags: NoteBulkActionMapper.normalizeTags(action.tags) };
      case 'remove_tags':
        return { kind: 'remove_tags', tags: NoteBulkActionMapper.normalizeTags(action.tags) };
    }
  }

  /** The archive state a bulk action leaves notes in, or undefined when it does not touch it. */
  static getArchiveStateAfterAction(action: NoteBulkAction): boolean | undefined {
    if (action.action === 'archive') return true;
    if (action.action === 'unarchive') return false;
    return undefined;
  }

  private static normalizeTags(tags: string[]): string[] {
    return Array.from(new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0)));
  }
}
