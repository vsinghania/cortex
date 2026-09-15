export type NoteSortField = 'updated_at' | 'created_at' | 'title';
export type NoteSortOrder = 'asc' | 'desc';

export type NoteListSortOption = {
  field: NoteSortField;
  order: NoteSortOrder;
};

export type ResolvedNoteSort = {
  sort: Record<string, 1 | -1 | { $meta: 'textScore' }>;
  by_relevance: boolean;
  needs_case_insensitive_collation: boolean;
};

export class NoteListSort {
  static readonly FIELDS = ['updated_at', 'created_at', 'title'] as const satisfies readonly NoteSortField[];
  static readonly ORDERS = ['asc', 'desc'] as const satisfies readonly NoteSortOrder[];

  private static readonly DEFAULT: NoteListSortOption = { field: 'updated_at', order: 'desc' };

  private constructor() {}

  /**
   * Builds an explicit sort from loose inputs. A missing order follows the field's natural
   * reading (A→Z for titles, newest first for dates); a bare order applies to `updated_at`.
   */
  static fromParts(parts: { field?: NoteSortField; order?: NoteSortOrder }): NoteListSortOption | undefined {
    if (!parts.field && !parts.order) return undefined;
    const field = parts.field ?? NoteListSort.DEFAULT.field;
    return { field, order: parts.order ?? (field === 'title' ? 'asc' : 'desc') };
  }

  /**
   * Pinned notes lead every explicit ordering. A text query without an explicit sort ranks by
   * relevance first, as it always has, with pins only breaking ties. `id` is the final
   * tiebreak so offset pages never overlap.
   */
  static resolve(params: { sort?: NoteListSortOption; has_query: boolean }): ResolvedNoteSort {
    if (params.has_query && !params.sort) {
      return {
        sort: { score: { $meta: 'textScore' }, is_pinned: -1, updated_at: -1, id: -1 },
        by_relevance: true,
        needs_case_insensitive_collation: false
      };
    }

    const { field, order } = params.sort ?? NoteListSort.DEFAULT;
    const direction = order === 'asc' ? 1 : -1;
    return {
      sort: { is_pinned: -1, [field]: direction, id: direction },
      by_relevance: false,
      needs_case_insensitive_collation: field === 'title'
    };
  }
}
