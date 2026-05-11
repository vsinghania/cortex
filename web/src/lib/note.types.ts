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
