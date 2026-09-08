import type { Corpus } from '../retrieval_svc/types/retrieval.types.js';

export type ResolvedDocuments = {
  /** document_id -> current title. A missing key means the document is gone. */
  titles: Map<string, string>;
  /** chunk_id -> heading path, for chunks that still exist. */
  heading_paths: Map<string, string[]>;
  /** chunk_ids that survived the latest re-index. */
  known_chunk_ids: Set<string>;
};

/**
 * The port a corpus implements so its documents can back citations. Mirrors
 * CorpusRetriever: one implementation per corpus, keyed off its own `corpus` field.
 *
 * Implementations live in their own domain module, never here - that is what keeps
 * citation_svc from depending on any particular corpus.
 */
export interface DocumentResolver {
  readonly corpus: Corpus;
  resolve(params: {
    user_id: string;
    document_ids: string[];
    chunk_ids: string[];
  }): Promise<ResolvedDocuments>;
}
