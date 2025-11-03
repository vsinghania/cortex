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

export interface NoteRepository {
  createNote(note: Note): Promise<Note>;

  getNoteByKey(params: {
    user_id: string;
    source: NoteSource;
    external_id: string;
  }): Promise<Note | null>;

  listNotes(params: NoteListParams): Promise<NoteListResult>;

  updateNoteByKey(params: {
    user_id: string;
    source: NoteSource;
    external_id: string;
    patch: Partial<Note>;
  }): Promise<Note | null>;

  deleteNoteByKey(params: {
    user_id: string;
    source: NoteSource;
    external_id: string;
  }): Promise<boolean>;

  searchNotes(params: {
    user_id: string;
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<NoteListResult>;
}
