export enum NoteSource {
  Notion = 'notion',
  OneNote = 'onenote',
  Evernote = 'evernote',
  AppleNotes = 'apple_notes',
  GoogleDocs = 'google_docs',
  Markdown = 'markdown',
  Other = 'other'
}

export enum SyncStatus {
  Idle = 'idle',
  Syncing = 'syncing',
  Ok = 'ok',
  Error = 'error'
}

export enum Visibility {
  Private = 'private',
  Shared = 'shared',
  Public = 'public'
}

export type NoteContainer = {
  container_type: 'notebook' | 'database' | 'folder' | 'page' | 'section' | 'collection' | 'other';
  container_id: string;
  container_name?: string;
};

export type NoteMetadata = {
  provider_url?: string;
  provider_etag?: string;
  provider_last_modified?: Date;
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
  user_id: string; // domain ID (UUID)
  source: NoteSource;
  external_id: string; // provider's unique id for the note/page
  title: string;
  body_plain: string;
  body_markdown?: string;
  tags: string[];
  container?: NoteContainer;

  created_at_provider?: Date;
  updated_at_provider?: Date;
  last_synced_at?: Date;
  sync_status: SyncStatus;

  is_archived: boolean;
  is_deleted: boolean;
  visibility: Visibility;

  metadata?: NoteMetadata;
  vectorization?: NoteVectorization;

  created_at: Date;
  updated_at: Date;
}
