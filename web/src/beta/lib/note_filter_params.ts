import type { NoteListQuery } from '../../lib/note.types';
import type { NoteFolderNode } from '../../lib/note_folder.types';
import type { NoteFilters, NoteSortMode } from './note_workspace.types';

export class NoteFilterParams {
  /** Mirrors the API's `folder_id=none`, which lists unfiled notes. */
  static readonly UNFILED = 'none';

  private static readonly DEFAULT_SORT: NoteSortMode = 'recent';

  static fromSearch(params: URLSearchParams): NoteFilters {
    const archived = params.get('archived') === 'only';
    return {
      // Archive is its own view, not a modifier of a folder.
      folder: archived ? null : params.get('folder'),
      archived,
      tag: params.get('tag'),
      q: params.get('q') ?? '',
      sort: params.get('sort') === 'az' ? 'az' : NoteFilterParams.DEFAULT_SORT,
    };
  }

  /** Serializes only non-default values so plain URLs stay plain. */
  static toSearch(filters: NoteFilters): string {
    const params = new URLSearchParams();
    if (filters.folder) params.set('folder', filters.folder);
    if (filters.archived) params.set('archived', 'only');
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.q) params.set('q', filters.q);
    if (filters.sort !== NoteFilterParams.DEFAULT_SORT) params.set('sort', filters.sort);
    const search = params.toString();
    return search ? `?${search}` : '';
  }

  static toListQuery(filters: NoteFilters): NoteListQuery {
    const q = filters.q.trim();
    return {
      q: q || undefined,
      tags: filters.tag ? [filters.tag] : undefined,
      folder_id: filters.folder ?? undefined,
      include_subfolders: NoteFilterParams.isRealFolder(filters.folder) ? true : undefined,
      archived: filters.archived ? 'only' : undefined,
      ...NoteFilterParams.sortQuery(filters.sort, q.length > 0),
    };
  }

  static isRealFolder(folder: string | null): folder is string {
    return !!folder && folder !== NoteFilterParams.UNFILED;
  }

  static contextLabel(filters: NoteFilters, folders_by_id: Map<string, NoteFolderNode>): string {
    if (filters.tag) return `#${filters.tag}`;
    if (filters.archived) return 'Archive';
    if (filters.folder === NoteFilterParams.UNFILED) return 'Unfiled';
    if (filters.folder) return folders_by_id.get(filters.folder)?.name ?? 'Folder';
    return 'All notes';
  }

  /** A search with the default "recent" order is left to the server's relevance ranking. */
  private static sortQuery(sort: NoteSortMode, has_query: boolean): Pick<NoteListQuery, 'sort' | 'order'> {
    if (sort === 'az') return { sort: 'title', order: 'asc' };
    if (has_query) return {};
    return { sort: 'updated_at', order: 'desc' };
  }
}
