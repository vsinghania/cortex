import type { QdrantClient } from '@qdrant/js-client-rest';
import type {
  ChunkVectorPoint,
  ChunkVectorRepository,
  VectorSearchHit,
  VectorSearchParams
} from './chunk_vector_repository_interface.js';
import { QdrantClientFactory } from '../../db/qdrant/qdrant_client_factory.js';
import type { NoteSource } from '../types/note.types.js';

const COLLECTION_NAME = 'note_chunks_vec';

export class QdrantChunkVectorRepository implements ChunkVectorRepository {

  private constructor(private readonly client: QdrantClient) {}

  static create(): QdrantChunkVectorRepository {
    return new QdrantChunkVectorRepository(QdrantClientFactory.getInstance());
  }

  static get collectionName(): string {
    return COLLECTION_NAME;
  }

  async upsertVectors(points: ChunkVectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.client.upsert(COLLECTION_NAME, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: {
          user_id: p.user_id,
          note_id: p.note_id,
          source: p.source
        }
      }))
    });
  }

  async searchTopK(params: VectorSearchParams): Promise<VectorSearchHit[]> {
    const must: Array<Record<string, unknown>> = [
      { key: 'user_id', match: { value: params.user_id } }
    ];
    if (params.source_filter && params.source_filter.length > 0) {
      must.push({ key: 'source', match: { any: params.source_filter } });
    }

    const result = await this.client.search(COLLECTION_NAME, {
      vector: params.query_vector,
      limit: params.k,
      filter: { must },
      with_payload: true
    });

    return result.map((hit) => ({
      id: String(hit.id),
      note_id: String((hit.payload as any)?.note_id ?? ''),
      source: ((hit.payload as any)?.source ?? 'native') as NoteSource,
      score: hit.score
    }));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.client.delete(COLLECTION_NAME, {
      wait: true,
      points: ids
    });
  }

  async deleteByNoteId(params: { user_id: string; note_id: string }): Promise<void> {
    await this.client.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [
          { key: 'user_id', match: { value: params.user_id } },
          { key: 'note_id', match: { value: params.note_id } }
        ]
      }
    });
  }
}
