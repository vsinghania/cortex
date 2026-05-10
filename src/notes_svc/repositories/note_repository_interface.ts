import type { Note, NoteSource } from '../types/note.types.js';

export type NoteListParams = {
  user_id: string;
  query?: string;
  limit?: number;
  offset?: number;
};

export type NoteListResult = {
  items: Note[];
  total: number;
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

export interface NoteRepository {
  createNote(note: Note): Promise<Note>;

  getNoteById(params: NoteByIdKey): Promise<Note | null>;
  getNoteByKey(params: NoteBySourceKey): Promise<Note | null>;
  getNotesByIds(params: { user_id: string; ids: string[] }): Promise<Note[]>;

  listNotes(params: NoteListParams): Promise<NoteListResult>;

  updateNoteById(params: NoteByIdKey & { patch: Partial<Note> }): Promise<Note | null>;
  updateNoteByKey(params: NoteBySourceKey & { patch: Partial<Note> }): Promise<Note | null>;

  deleteNoteById(params: NoteByIdKey): Promise<boolean>;
  deleteNoteByKey(params: NoteBySourceKey): Promise<boolean>;

  searchNotes(params: {
    user_id: string;
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<NoteListResult>;
}
