import type { VectorizationStatus } from './note.types.js';

export type NoteChunkVectorization = {
  status: VectorizationStatus;
  last_embedded_at?: Date;
  embedding_model?: string;
};

export interface NoteChunk {
  id: string; // domain ID (UUID v7); also used as Qdrant point id
  user_id: string; // domain ID (UUID)
  note_id: string; // Note domain ID
  chunk_index: number; // 0-based
  content: string;
  token_count?: number;
  hash?: string; // sha256 of content; used for diff/dedup
  heading_path?: string[];

  vectorization?: NoteChunkVectorization;

  created_at: Date;
  updated_at: Date;
}
