import type { Corpus, RawRetrievedChunk, RetrieveParams } from './types/retrieval.types.js';

export interface CorpusRetriever {
  readonly corpus: Corpus;
  retrieve(params: RetrieveParams): Promise<RawRetrievedChunk[]>;
}
