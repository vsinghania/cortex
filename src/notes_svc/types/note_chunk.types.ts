import type { VectorizationStatus } from './note.types.js';

export type NoteChunkVectorization = {
  status: VectorizationStatus;
  last_embedded_at?: Date;
  embedding_model?: string;
};

export interface NoteChunk {
  user_id: string; // domain ID (UUID)
  note_id: string; // Note domain ID (UUID or external mapping in repository)
  chunk_index: number; // 0-based
  content: string; // chunk text
  token_count?: number;
  hash?: string; // optional dedup hash

  vectorization?: NoteChunkVectorization;

  created_at: Date;
  updated_at: Date;
}
