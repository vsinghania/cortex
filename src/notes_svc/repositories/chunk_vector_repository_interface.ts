import type { NoteSource } from '../types/note.types.js';

export type ChunkVectorPoint = {
  id: string;
  vector: number[];
  user_id: string;
  note_id: string;
  source: NoteSource;
};

export type VectorSearchHit = {
  id: string;
  note_id: string;
  source: NoteSource;
  score: number;
};

export type VectorSearchParams = {
  user_id: string;
  query_vector: number[];
  k: number;
  source_filter?: NoteSource[];
};

export interface ChunkVectorRepository {
  upsertVectors(points: ChunkVectorPoint[]): Promise<void>;

  searchTopK(params: VectorSearchParams): Promise<VectorSearchHit[]>;

  deleteByIds(ids: string[]): Promise<void>;

  deleteByNoteId(params: { user_id: string; note_id: string }): Promise<void>;
}
