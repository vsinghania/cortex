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

export interface Note {
  id: string; // domain ID (nanoid for native, may also be set for source-keyed notes)
  user_id: string; // domain ID (UUID)
  source: NoteSource;
  external_id?: string; // provider's unique id; absent for native notes

  title: string;
  body: string; // canonical markdown
  body_raw?: string; // original artifact (raw HTML, voice transcript, serialized chat turns)

  tags: string[];
  container?: NoteContainer;
  folder_id?: string; // NoteFolder domain ID; absent = unfiled

  provider_created_at?: Date;
  provider_updated_at?: Date;
  last_synced_at?: Date;
  sync_status: SyncStatus;

  is_archived: boolean;
  is_pinned: boolean;
  is_deleted: boolean;

  metadata?: NoteMetadata;
  vectorization?: NoteVectorization;

  created_at: Date;
  updated_at: Date;
}

export type NoteLocator =
  | { id: string }
  | { source: NoteSource; external_id: string };
