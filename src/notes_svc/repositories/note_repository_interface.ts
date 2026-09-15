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

export type NotePatchFields = Partial<Note>;

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

export interface NoteRepository {
  createNote(note: Note): Promise<Note>;

  getNoteById(params: NoteByIdKey): Promise<Note | null>;
  getNoteByKey(params: NoteBySourceKey): Promise<Note | null>;
  getNotesByIds(params: { user_id: string; ids: string[] }): Promise<Note[]>;

  listNotes(params: NoteListParams): Promise<NoteListResult>;

  /** Distinct tags for one user with note counts, case-folded, most-used first. */
  listTags(params: { user_id: string; limit?: number }): Promise<NoteTagCount[]>;

  updateNoteById(params: NoteByIdKey & { patch: NotePatchFields }): Promise<Note | null>;
  updateNoteByKey(params: NoteBySourceKey & { patch: NotePatchFields }): Promise<Note | null>;

  deleteNoteById(params: NoteByIdKey): Promise<boolean>;
  deleteNoteByKey(params: NoteBySourceKey): Promise<boolean>;

  searchNotes(params: NoteSearchParams): Promise<NoteListResult>;

  /** Admin maintenance sweeps only - see NoteMaintenanceParams. */
  listNotesForMaintenance(params: NoteMaintenanceParams): Promise<Note[]>;
  countNotesForMaintenance(params: Omit<NoteMaintenanceParams, 'after_id' | 'limit'>): Promise<number>;
}
