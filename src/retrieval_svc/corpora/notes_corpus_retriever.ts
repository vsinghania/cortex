import { performance } from 'node:perf_hooks';
import type { CorpusRetriever } from '../corpus_retriever_interface.js';
import type { RawRetrievedChunk, RetrieveParams } from '../types/retrieval.types.js';
import { Corpus } from '../types/retrieval.types.js';
import type { NoteChunkRepository } from '../../notes_svc/repositories/note_chunk_repository_interface.js';
import type {
  ChunkVectorRepository,
  VectorSearchHit
} from '../../notes_svc/repositories/chunk_vector_repository_interface.js';
import type { NoteChunk } from '../../notes_svc/types/note_chunk.types.js';
import type { NoteSource } from '../../notes_svc/types/note.types.js';
import { MongooseNoteChunkRepository } from '../../notes_svc/repositories/mongoose_note_chunk_repository.js';
import { QdrantChunkVectorRepository } from '../../notes_svc/repositories/qdrant_chunk_vector_repository.js';
import { EmbeddingsSvc } from '../../embeddings_svc/embeddings_svc.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';
import { logger } from '../../common/logger.js';
import { logExecTime } from '../../lib/decorators/logging_decorators.js';

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;
const SNIPPET_MAX_CHARS = 600;

export class NotesCorpusRetriever implements CorpusRetriever {

  readonly corpus = Corpus.Notes;

  private constructor(
    private readonly chunk_repo: NoteChunkRepository,
    private readonly vector_repo: ChunkVectorRepository,
    private readonly embeddings: EmbeddingsSvc
  ) {}

  static async create(): Promise<NotesCorpusRetriever> {
    const db = DbNameResolver.resolve('notes');
    const chunk_repo = await MongooseNoteChunkRepository.create({ db });
    return new NotesCorpusRetriever(
      chunk_repo,
      QdrantChunkVectorRepository.create(),
      EmbeddingsSvc.getInstance()
    );
  }

  @logExecTime({ threshold_in_ms: 3000 })
  async retrieve(params: RetrieveParams): Promise<RawRetrievedChunk[]> {
    const start_ms = performance.now();
    const top_k = NotesCorpusRetriever.normalizeTopK(params.top_k);
    const source_filter = NotesCorpusRetriever.coerceSourceFilter(params.source_filter);

    const query_result = await this.embeddings.embedQuery(params.question);

    const hits = await this.vector_repo.searchTopK({
      user_id: params.user_id,
      query_vector: query_result.vector,
      k: top_k,
      source_filter
    });

    if (hits.length === 0) {
      logger.info(
        {
          user_id: params.user_id,
          top_k,
          source_filter,
          embedding_model: query_result.model,
          duration_ms: Number((performance.now() - start_ms).toFixed(1))
        },
        'notes corpus retrieval returned no hits'
      );
      return [];
    }

    const chunks = await this.chunk_repo.getChunksByIds({
      user_id: params.user_id,
      ids: hits.map((h) => h.id)
    });

    const out = NotesCorpusRetriever.assembleRaw(hits, chunks);

    logger.info(
      {
        user_id: params.user_id,
        top_k,
        hit_count: out.length,
        embedding_model: query_result.model,
        duration_ms: Number((performance.now() - start_ms).toFixed(1))
      },
      'notes corpus retrieval completed'
    );

    return out;
  }

  private static assembleRaw(hits: VectorSearchHit[], chunks: NoteChunk[]): RawRetrievedChunk[] {
    const chunk_by_id = new Map(chunks.map((c) => [c.id, c]));
    const out: RawRetrievedChunk[] = [];
    for (const hit of hits) {
      const chunk = chunk_by_id.get(hit.id);
      if (!chunk) continue;
      out.push({
        chunk_id: chunk.id,
        document_id: chunk.note_id,
        corpus: Corpus.Notes,
        source: hit.source ?? 'native',
        chunk_index: chunk.chunk_index,
        heading_path: chunk.heading_path,
        snippet: NotesCorpusRetriever.toSnippet(chunk.content),
        score: hit.score
      });
    }
    return out;
  }

  private static toSnippet(content: string): string {
    if (content.length <= SNIPPET_MAX_CHARS) return content;
    return `${content.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd()}…`;
  }

  private static normalizeTopK(top_k?: number): number {
    if (!top_k || top_k <= 0) {
      const env_default = Number(process.env.RAG_TOP_K) || DEFAULT_TOP_K;
      return Math.min(MAX_TOP_K, Math.max(1, env_default));
    }
    return Math.min(MAX_TOP_K, Math.max(1, Math.floor(top_k)));
  }

  private static coerceSourceFilter(source_filter?: string[]): NoteSource[] | undefined {
    if (!source_filter || source_filter.length === 0) return undefined;
    return source_filter as NoteSource[];
  }
}
