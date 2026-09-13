export enum NoteSource {
  Native = 'native',
  Notion = 'notion',
  OneNote = 'onenote',
  Evernote = 'evernote',
  Other = 'other'
}

export enum SyncStatus {
  Idle = 'idle',
  Syncing = 'syncing',
  Ok = 'ok',
  Error = 'error'
}

export type NoteContainer = {
  container_type: 'notebook' | 'database' | 'folder' | 'page' | 'section' | 'collection' | 'other';
  container_id: string;
  container_name?: string;
};

export type NoteMetadata = {
  provider_url?: string;
  provider_etag?: string;
  extra?: Record<string, unknown>;
};

export type VectorizationStatus = 'none' | 'pending' | 'embedded' | 'error';

export type NoteVectorization = {
  status: VectorizationStatus;
  last_embedded_at?: Date;
  embedding_model?: string;
  chunk_count?: number;
};

export type NoteDocAttrs = Record<string, string | number | boolean | null>;

export type NoteDocMark = {
  type: string;
  attrs?: NoteDocAttrs;
};

/** One node of the rich editor's (Tiptap/ProseMirror) JSON document. */
export type NoteDocNode = {
  type: string;
  attrs?: NoteDocAttrs;
  content?: NoteDocNode[];
  marks?: NoteDocMark[];
  text?: string;
};

export interface Note {
  id: string; // domain ID (nanoid for native, may also be set for source-keyed notes)
  user_id: string; // domain ID (UUID)
  source: NoteSource;
  external_id?: string; // provider's unique id; absent for native notes

  title: string;
  body: string; // canonical markdown; for rich notes, derived client-side from body_doc
  body_raw?: string; // original artifact (raw HTML, voice transcript, serialized chat turns)

  /**
   * Rich editor document the UI renders. `body` is a lossy markdown projection of it used
   * for chunking, search and agents; the two are only consistent while `body_doc_version`
   * matches the serializer that produced `body`.
   */
  body_doc?: NoteDocNode;
  body_doc_version?: number;

  tags: string[];
  container?: NoteContainer;

  provider_created_at?: Date;
  provider_updated_at?: Date;
  last_synced_at?: Date;
  sync_status: SyncStatus;

  is_archived: boolean;
  is_deleted: boolean;

  metadata?: NoteMetadata;
  vectorization?: NoteVectorization;

  created_at: Date;
  updated_at: Date;
}

type NoteImmutableField = 'id' | 'user_id' | 'source' | 'external_id' | 'created_at' | 'updated_at';
type NoteDocField = 'body_doc' | 'body_doc_version';

export type NotePatch = Partial<Omit<Note, NoteImmutableField | NoteDocField>> & {
  /** `null` clears the stored value. */
  body_doc?: NoteDocNode | null;
  body_doc_version?: number | null;
};

export type NoteLocator =
  | { id: string }
  | { source: NoteSource; external_id: string };
