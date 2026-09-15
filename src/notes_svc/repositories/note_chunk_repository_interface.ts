import type { NoteChunk } from '../types/note_chunk.types.js';

export interface NoteChunkRepository {
  upsertChunks(chunks: NoteChunk[]): Promise<void>;

  getChunksByNote(params: { user_id: string; note_id: string }): Promise<NoteChunk[]>;

  getChunksByIds(params: { user_id: string; ids: string[] }): Promise<NoteChunk[]>;

  deleteByNoteId(params: { user_id: string; note_id: string }): Promise<string[]>;

  deleteByNoteIds(params: { user_id: string; note_ids: string[] }): Promise<number>;

  deleteByIds(params: { user_id: string; ids: string[] }): Promise<number>;
}
