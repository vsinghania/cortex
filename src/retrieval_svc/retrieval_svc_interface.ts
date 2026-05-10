import type { CorpusRetriever } from './corpus_retriever_interface.js';
import type { Corpus, RawRetrievedChunk, RetrieveParams } from './types/retrieval.types.js';

export interface RetrievalSvcInterface {
  register(retriever: CorpusRetriever): void;
  retrieve(corpus: Corpus, params: RetrieveParams): Promise<RawRetrievedChunk[]>;
  retrieveAcross(corpora: Corpus[], params: RetrieveParams): Promise<RawRetrievedChunk[]>;
}
