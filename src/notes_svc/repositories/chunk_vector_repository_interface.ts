import type { NoteSource } from '../types/note.types.js';

export type ChunkVectorPoint = {
  id: string;
  vector: number[];
  user_id: string;
  note_id: string;
  source: NoteSource;
  is_archived: boolean;
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
  include_archived?: boolean;
};

export interface ChunkVectorRepository {
  upsertVectors(points: ChunkVectorPoint[]): Promise<void>;

  searchTopK(params: VectorSearchParams): Promise<VectorSearchHit[]>;

  deleteByIds(ids: string[]): Promise<void>;

  deleteByNoteId(params: { user_id: string; note_id: string }): Promise<void>;

  deleteByNoteIds(params: { user_id: string; note_ids: string[] }): Promise<void>;

  /** Mirrors a note's archive flag onto its points so semantic search can exclude it. */
  setArchived(params: { user_id: string; note_ids: string[]; is_archived: boolean }): Promise<void>;
}
