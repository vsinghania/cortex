import type { Note, NoteSource } from '../types/note.types.js';
import type { NoteListSortOption } from '../note_list_sort.js';

/**
 * Structured, additive note filters. Add named fields here as new filters are needed;
 * keep it a plain typed struct rather than a generic {field, operator, value} DSL.
 */
export type NoteArchivedFilter = 'exclude' | 'only' | 'include';

export type NoteListFilter = {
  /** Matches notes carrying ALL of these tags, ignoring case. */
  tags?: string[];
  /** Defaults to 'exclude': archived notes stay out of lists unless asked for. */
  archived?: NoteArchivedFilter;
  pinned?: boolean;
  /** Notes filed directly in any of these folders. Resolved from a folder tree by the service. */
  folder_ids?: string[];
  /** Notes not filed in any folder. */
  unfiled?: boolean;
};

export type NoteListParams = {
  user_id: string;
  query?: string;
  filter?: NoteListFilter;
  sort?: NoteListSortOption;
  limit?: number;
  offset?: number;
};

export type NoteSearchParams = {
  user_id: string;
  query: string;
  archived?: NoteArchivedFilter;
  limit?: number;
  offset?: number;
};

/** `folder_id: null` files the note out of its folder. */
export type NotePatchFields = Partial<Omit<Note, 'folder_id'>> & { folder_id?: string | null };

export type NoteOrganizationFields = {
  is_pinned?: boolean;
  is_archived?: boolean;
  folder_id?: string | null;
};

export type NoteBulkUpdate =
  | { kind: 'organize'; fields: NoteOrganizationFields }
  | { kind: 'add_tags'; tags: string[] }
  | { kind: 'remove_tags'; tags: string[] };

export type NoteBulkUpdateResult = {
  matched: number;
  modified: number;
};

export type NoteFolderCount = {
  folder_id: string;
  count: number;
};

export type NoteListResult = {
  items: Note[];
  total: number;
};

/** One row of the tag facet: a representative casing of the tag, and how many notes carry it. */
export type NoteTagCount = {
  tag: string;
  count: number;
};

export type NoteByIdKey = {
  user_id: string;
  id: string;
};

export type NoteBySourceKey = {
  user_id: string;
  source: NoteSource;
  external_id: string;
};

/**
 * Admin-only, and the one read path that is NOT user-scoped: a maintenance sweep
 * may legitimately target every note in the system. Cursor on `id` rather than an
 * offset because note ids are UUIDv7, so they sort chronologically, `id` is already
 * uniquely indexed, and a `$gt` cursor stays stable while the sweep mutates rows
 * underneath it.
 */
export type NoteMaintenanceParams = {
  user_ids?: string[];
  note_ids?: string[];
  after_id?: string;
  limit: number;
};

/**
 * Admin-only, and NOT user-scoped: the admin users view reads counts for a page of
 * users at once. Batched on `user_ids` so a page costs one aggregation, not one per user.
 */
export type NoteUserCounts = {
  user_id: string;
  total: number;
  archived: number;
  by_source: Partial<Record<NoteSource, number>>;
};

export interface NoteRepository {
  createNote(note: Note): Promise<Note>;

  getNoteById(params: NoteByIdKey): Promise<Note | null>;
  getNoteByKey(params: NoteBySourceKey): Promise<Note | null>;
  getNotesByIds(params: { user_id: string; ids: string[] }): Promise<Note[]>;

  listNotes(params: NoteListParams): Promise<NoteListResult>;

  /** Distinct tags for one user with note counts, case-folded, most-used first. `all` bypasses the facet limit. */
  listTags(params: { user_id: string; limit?: number; all?: boolean }): Promise<NoteTagCount[]>;

  /** Case-insensitively strips one tag from every note of the user; returns notes changed. */
  removeTagEverywhere(params: { user_id: string; tag: string }): Promise<number>;

  /** Non-archived note counts per folder, for folder tree badges. Unfiled notes are omitted. */
  countNotesByFolder(params: { user_id: string }): Promise<NoteFolderCount[]>;

  listNoteIdsInFolders(params: { user_id: string; folder_ids: string[] }): Promise<string[]>;

  updateNoteById(params: NoteByIdKey & { patch: NotePatchFields }): Promise<Note | null>;
  updateNoteByKey(params: NoteBySourceKey & { patch: NotePatchFields }): Promise<Note | null>;

  bulkUpdateNotes(params: { user_id: string; ids: string[]; update: NoteBulkUpdate }): Promise<NoteBulkUpdateResult>;

  deleteNoteById(params: NoteByIdKey): Promise<boolean>;
  deleteNoteByKey(params: NoteBySourceKey): Promise<boolean>;

  /** Snapshots every matching note to trash, then deletes them; returns the ids actually deleted. */
  deleteNotesByIds(params: { user_id: string; ids: string[] }): Promise<string[]>;

  searchNotes(params: NoteSearchParams): Promise<NoteListResult>;

  /** Admin maintenance sweeps only - see NoteMaintenanceParams. */
  listNotesForMaintenance(params: NoteMaintenanceParams): Promise<Note[]>;
  countNotesForMaintenance(params: Omit<NoteMaintenanceParams, 'after_id' | 'limit'>): Promise<number>;

  /** Admin users view only - see NoteUserCounts. Users with no notes are omitted. */
  countNotesByUser(params: { user_ids: string[] }): Promise<NoteUserCounts[]>;
}
