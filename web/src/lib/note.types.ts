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

/** Mirrors VectorizationStatus in src/notes_svc/types/note.types.ts; `pending` means a deferred embed is queued. */
export type NoteVectorizationStatus = 'none' | 'pending' | 'embedded' | 'error';

export type Note = {
  id: string;
  user_id: string;
  source: string;
  title: string;
  body: string;
  body_raw?: string;
  tags: string[];
  container?: NoteContainer;
  folder_id?: string;
  is_archived: boolean;
  is_pinned?: boolean;
  is_deleted: boolean;
  vectorization?: { status: NoteVectorizationStatus };
  created_at: string;
  updated_at: string;
};

export type NoteCreateBody = {
  title: string;
  body?: string;
  tags?: string[];
  container?: NoteContainer;
  folder_id?: string;
};

export type NotePatchBody = {
  title?: string;
  body?: string;
  tags?: string[];
  container?: NoteContainer;
  folder_id?: string | null;
  is_archived?: boolean;
  is_pinned?: boolean;
};

export type NoteSortField = 'updated_at' | 'created_at' | 'title';
export type NoteSortOrder = 'asc' | 'desc';

/** Mirrors NoteListQuerySchema in src/web-server/notes/notes.controller.ts. `folder_id: 'none'` lists unfiled notes. */
export type NoteListQuery = {
  limit?: number;
  offset?: number;
  tags?: string[];
  q?: string;
  folder_id?: string;
  include_subfolders?: boolean;
  archived?: 'exclude' | 'only' | 'include';
  pinned?: boolean;
  sort?: NoteSortField;
  order?: NoteSortOrder;
};

export type NoteListResponse = {
  items: Note[];
  total: number;
};

/** Mirrors NoteBulkAction in src/notes_svc/types/note_bulk.types.ts */
export type NoteBulkAction =
  | { action: 'move'; folder_id: string | null }
  | { action: 'archive' }
  | { action: 'unarchive' }
  | { action: 'pin' }
  | { action: 'unpin' }
  | { action: 'add_tags'; tags: string[] }
  | { action: 'remove_tags'; tags: string[] }
  | { action: 'delete' };

/** Mirrors NoteBulkResult in src/notes_svc/types/note_bulk.types.ts */
export type NoteBulkResult = {
  action: NoteBulkAction['action'];
  matched: number;
  modified: number;
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

/** A character range inside a note body, e.g. the span a citation points at. */
export type HighlightRange = { start: number; end: number };
