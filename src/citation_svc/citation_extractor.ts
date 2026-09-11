import { z } from 'zod';
import type { Citation } from './types/citation.types.js';
import { Corpus } from '../retrieval_svc/types/retrieval.types.js';
import { logger } from '../common/logger.js';

/**
 * Shape of one entry in a retrieval tool result. The payload has round-tripped through the
 * model SDK, so it is validated rather than trusted. Only the identity fields a citation
 * stores are read; title/snippet/heading are ignored because those are resolved live.
 */
const RetrievedChunkSchema = z.object({
  chunk_id: z.string().min(1),
  document_id: z.string().min(1),
  corpus: z.nativeEnum(Corpus).optional(),
});

const ToolResultSchema = z.object({
  chunks: z.array(RetrievedChunkSchema),
});

type RetrievedChunkLike = z.infer<typeof RetrievedChunkSchema>;

export class CitationExtractor {
  private static readonly MARKER_PATTERN = /\[c:([^\]\s]+)\]/g;

  /** How agents are taught to write a marker; must stay parseable by MARKER_PATTERN. */
  static readonly MARKER_SYNTAX = CitationExtractor.markerFor('<chunk_id>');

  private constructor() {}

  static markerFor(chunk_id: string): string {
    return `[c:${chunk_id}]`;
  }

  /**
   * Intersects the markers in an answer with the chunks retrieval actually returned this
   * turn, so the model cannot cite a document it never saw.
   *
   * `tool_payloads` are already-parsed tool results, not messages - keeping this input
   * corpus- and transport-neutral is what stops citation_svc depending on agent_svc.
   */
  static extract(params: { tool_payloads: unknown[]; answer_text?: string }): Citation[] {
    if (!params.answer_text) return [];

    const cited_ids = CitationExtractor.citedChunkIds(params.answer_text);
    if (cited_ids.length === 0) return [];

    const chunks_by_id = CitationExtractor.indexRetrievedChunks(params.tool_payloads);
    const citations: Citation[] = [];

    for (const chunk_id of cited_ids) {
      const chunk = chunks_by_id.get(chunk_id);
      if (!chunk) continue;
      citations.push(CitationExtractor.toCitation(chunk, citations.length + 1));
    }

    if (citations.length < cited_ids.length) {
      logger.debug(
        { cited_count: cited_ids.length, resolved_count: citations.length },
        'some citation markers could not be resolved'
      );
    }

    return citations;
  }

  /** Chunk ids in order of first appearance, deduped. */
  private static citedChunkIds(answer_text: string): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const match of answer_text.matchAll(CitationExtractor.MARKER_PATTERN)) {
      const chunk_id = match[1];
      if (seen.has(chunk_id)) continue;
      seen.add(chunk_id);
      ids.push(chunk_id);
    }
    return ids;
  }

  private static indexRetrievedChunks(payloads: unknown[]): Map<string, RetrievedChunkLike> {
    const by_id = new Map<string, RetrievedChunkLike>();
    for (const payload of payloads) {
      const parsed = ToolResultSchema.safeParse(payload);
      if (!parsed.success) continue;
      for (const chunk of parsed.data.chunks) {
        if (!by_id.has(chunk.chunk_id)) by_id.set(chunk.chunk_id, chunk);
      }
    }
    return by_id;
  }

  private static toCitation(chunk: RetrievedChunkLike, index: number): Citation {
    return {
      index,
      chunk_id: chunk.chunk_id,
      document_id: chunk.document_id,
      // Notes is the only corpus with a retriever today; older payloads predate the field.
      corpus: chunk.corpus ?? Corpus.Notes,
    };
  }
}
