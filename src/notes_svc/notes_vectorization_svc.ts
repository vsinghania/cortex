import { performance } from 'node:perf_hooks';
import type { Note, NoteVectorization } from './types/note.types.js';
import type { NoteChunk } from './types/note_chunk.types.js';
import type { NoteRepository } from './repositories/note_repository_interface.js';
import type { NoteChunkRepository } from './repositories/note_chunk_repository_interface.js';
import type { ChunkVectorRepository } from './repositories/chunk_vector_repository_interface.js';
import { MongooseNoteRepository } from './repositories/mongoose_note_repository.js';
import { MongooseNoteChunkRepository } from './repositories/mongoose_note_chunk_repository.js';
import { QdrantChunkVectorRepository } from './repositories/qdrant_chunk_vector_repository.js';
import { EmbeddingsSvc } from '../embeddings_svc/embeddings_svc.js';
import { MarkdownChunker, type ChunkSpec } from '../lib/text/markdown_chunker.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';
import { logger } from '../common/logger.js';
import { logExecTime } from '../lib/decorators/logging_decorators.js';

const DEFAULT_TARGET_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 64;

type DraftChunk = {
  chunk_index: number;
  spec: ChunkSpec;
  existing_id?: string;
};

export class NotesVectorizationSvc {

  private constructor(
    private readonly notes_repo: NoteRepository,
    private readonly chunk_repo: NoteChunkRepository,
    private readonly vector_repo: ChunkVectorRepository,
    private readonly embeddings: EmbeddingsSvc
  ) {}

  static async create(): Promise<NotesVectorizationSvc> {
    const db = DbNameResolver.resolve('notes');
    const [notes_repo, chunk_repo] = await Promise.all([
      MongooseNoteRepository.create({ db }),
      MongooseNoteChunkRepository.create({ db })
    ]);
    return new NotesVectorizationSvc(
      notes_repo,
      chunk_repo,
      QdrantChunkVectorRepository.create(),
      EmbeddingsSvc.getInstance()
    );
  }

  @logExecTime({ threshold_in_ms: 5000 })
  async vectorizeNote(note: Note): Promise<NoteVectorization> {
    const start_ms = performance.now();
    const { target_tokens, overlap_tokens } = NotesVectorizationSvc.readChunkOpts();
    const specs = MarkdownChunker.chunk(note.body ?? '', { target_tokens, overlap_tokens });

    if (specs.length === 0) {
      await this.removeNoteVectors({ user_id: note.user_id, note_id: note.id });
      return { status: 'none', chunk_count: 0 };
    }

    try {
      const existing = await this.chunk_repo.getChunksByNote({ user_id: note.user_id, note_id: note.id });
      const existing_by_index = new Map(existing.map((c) => [c.chunk_index, c]));

      const reused_chunks: NoteChunk[] = [];
      const drafts_to_embed: DraftChunk[] = [];

      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const ex = existing_by_index.get(i);
        if (ex && ex.hash === spec.hash && ex.vectorization?.status === 'embedded') {
          reused_chunks.push({
            ...ex,
            heading_path: spec.heading_path,
            updated_at: new Date()
          });
        } else {
          drafts_to_embed.push({ chunk_index: i, spec, existing_id: ex?.id });
        }
      }

      const obsolete = existing.filter((c) => c.chunk_index >= specs.length);
      if (obsolete.length) {
        const obsolete_ids = obsolete.map((c) => c.id);
        await this.chunk_repo.deleteByIds({ user_id: note.user_id, ids: obsolete_ids });
        await this.vector_repo.deleteByIds(obsolete_ids);
      }

      const now = new Date();
      let model = this.embeddings.model;
      let vectors: number[][] = [];
      if (drafts_to_embed.length > 0) {
        const result = await this.embeddings.embedTexts(drafts_to_embed.map((d) => d.spec.content));
        vectors = result.vectors;
        model = result.model;
      }

      const new_chunks: NoteChunk[] = drafts_to_embed.map((draft, idx) => ({
        id: draft.existing_id ?? Id.generateUuidV7(),
        user_id: note.user_id,
        note_id: note.id,
        chunk_index: draft.chunk_index,
        content: draft.spec.content,
        token_count: draft.spec.token_count,
        hash: draft.spec.hash,
        heading_path: draft.spec.heading_path,
        vectorization: {
          status: 'embedded',
          last_embedded_at: now,
          embedding_model: model
        },
        created_at: existing_by_index.get(draft.chunk_index)?.created_at ?? now,
        updated_at: now
      }));

      await this.chunk_repo.upsertChunks([...reused_chunks, ...new_chunks]);

      if (new_chunks.length > 0) {
        await this.vector_repo.upsertVectors(
          new_chunks.map((chunk, idx) => ({
            id: chunk.id,
            vector: vectors[idx],
            user_id: chunk.user_id,
            note_id: chunk.note_id,
            source: note.source
          }))
        );
      }

      const vectorization: NoteVectorization = {
        status: 'embedded',
        chunk_count: specs.length,
        last_embedded_at: now,
        embedding_model: model
      };

      await this.notes_repo.updateNoteById({
        user_id: note.user_id,
        id: note.id,
        patch: { vectorization }
      });

      logger.info(
        {
          note_id: note.id,
          chunk_count: specs.length,
          reused_count: reused_chunks.length,
          embedded_count: new_chunks.length,
          obsolete_count: obsolete.length,
          model,
          duration_ms: Time.elapsedMs(start_ms)
        },
        'note vectorized'
      );

      return vectorization;
    } catch (err) {
      const failure: NoteVectorization = {
        status: 'error',
        chunk_count: 0
      };
      try {
        await this.notes_repo.updateNoteById({
          user_id: note.user_id,
          id: note.id,
          patch: { vectorization: failure }
        });
      } catch (persist_err) {
        logger.warn(
          { err: persist_err, note_id: note.id },
          'failed to persist vectorization error status'
        );
      }
      throw err;
    }
  }

  async revectorizeNote(params: { user_id: string; note_id: string }): Promise<NoteVectorization | null> {
    const note = await this.notes_repo.getNoteById({ user_id: params.user_id, id: params.note_id });
    if (!note) return null;
    await this.removeNoteVectors(params);
    return this.vectorizeNote(note);
  }

  async removeNoteVectors(params: { user_id: string; note_id: string }): Promise<void> {
    const ids = await this.chunk_repo.deleteByNoteId(params);
    if (ids.length === 0) {
      await this.vector_repo.deleteByNoteId(params);
      return;
    }
    await this.vector_repo.deleteByNoteId(params);
    await this.notes_repo.updateNoteById({
      user_id: params.user_id,
      id: params.note_id,
      patch: { vectorization: { status: 'none', chunk_count: 0 } }
    });
    logger.info({ note_id: params.note_id, deleted_chunks: ids.length }, 'note vectors removed');
  }

  private static readChunkOpts(): { target_tokens: number; overlap_tokens: number } {
    return {
      target_tokens: Number(process.env.CHUNK_TARGET_TOKENS) || DEFAULT_TARGET_TOKENS,
      overlap_tokens: Number(process.env.CHUNK_OVERLAP_TOKENS) || DEFAULT_OVERLAP_TOKENS
    };
  }
}
