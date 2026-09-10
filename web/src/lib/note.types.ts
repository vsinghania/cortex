export type NoteContainerType =
  | 'notebook'
  | 'database'
  | 'folder'
  | 'page'
  | 'section'
  | 'collection'
  | 'other';

export type NoteContainer = {
  container_type: NoteContainerType;
  container_id: string;
  container_name?: string;
};

export type Note = {
  id: string;
  user_id: string;
  source: string;
  title: string;
  body: string;
  body_raw?: string;
  tags: string[];
  container?: NoteContainer;
  is_archived: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type NoteCreateBody = {
  title: string;
  body?: string;
  tags?: string[];
  container?: NoteContainer;
};

export type NotePatchBody = {
  title?: string;
  body?: string;
  tags?: string[];
  container?: NoteContainer;
  is_archived?: boolean;
};

export type NoteListResponse = {
  items: Note[];
  total: number;
};

/** Mirrors NoteTagCount in src/notes_svc/repositories/note_repository_interface.ts */
export type NoteTagCount = {
  tag: string;
  count: number;
};

/** Mirrors NoteChunkRef in src/notes_svc/types/note_chunk.types.ts */
export type NoteChunkRef = {
  id: string;
  note_id: string;
  chunk_index: number;
  heading_path?: string[];
  start_offset?: number;
  end_offset?: number;
  content: string;
};
