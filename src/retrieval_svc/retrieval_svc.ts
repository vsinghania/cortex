import type { CorpusRetriever } from './corpus_retriever_interface.js';
import type { RetrievalSvcInterface } from './retrieval_svc_interface.js';
import type { RawRetrievedChunk, RetrieveParams } from './types/retrieval.types.js';
import { Corpus } from './types/retrieval.types.js';
import { NotesCorpusRetriever } from './corpora/notes_corpus_retriever.js';
import { NotFoundError } from '../common/errors.js';
import { logger } from '../common/logger.js';

export class RetrievalSvc implements RetrievalSvcInterface {
  private static instance: RetrievalSvc | null = null;
  private static in_flight: Promise<RetrievalSvc> | null = null;

  private retrievers = new Map<Corpus, CorpusRetriever>();

  private constructor() {}

  static async getInstance(): Promise<RetrievalSvc> {
    if (RetrievalSvc.instance) return RetrievalSvc.instance;
    if (RetrievalSvc.in_flight) return RetrievalSvc.in_flight;
    RetrievalSvc.in_flight = RetrievalSvc.loadInstance();
    return RetrievalSvc.in_flight;
  }

  static async create(): Promise<RetrievalSvc> {
    return RetrievalSvc.getInstance();
  }

  static getExistingInstance(): RetrievalSvc | null {
    return RetrievalSvc.instance;
  }

  register(retriever: CorpusRetriever): void {
    if (this.retrievers.has(retriever.corpus)) {
      logger.warn(
        { corpus: retriever.corpus },
        'RetrievalSvc: corpus retriever already registered; replacing'
      );
    }
    this.retrievers.set(retriever.corpus, retriever);
    logger.info({ corpus: retriever.corpus }, 'RetrievalSvc: registered corpus');
  }

  async retrieve(corpus: Corpus, params: RetrieveParams): Promise<RawRetrievedChunk[]> {
    const retriever = this.retrievers.get(corpus);
    if (!retriever) {
      throw new NotFoundError(`No retriever registered for corpus: ${corpus}`);
    }
    return retriever.retrieve(params);
  }

  async retrieveAcross(corpora: Corpus[], params: RetrieveParams): Promise<RawRetrievedChunk[]> {
    if (corpora.length === 0) return [];
    const results = await Promise.all(corpora.map((c) => this.retrieve(c, params)));
    return results.flat().sort((a, b) => b.score - a.score);
  }

  listCorpora(): Corpus[] {
    return Array.from(this.retrievers.keys());
  }

  private static async loadInstance(): Promise<RetrievalSvc> {
    try {
      const inst = new RetrievalSvc();
      const notes_retriever = await NotesCorpusRetriever.create();
      inst.register(notes_retriever);
      RetrievalSvc.instance = inst;
      logger.info({ corpora: inst.listCorpora() }, 'RetrievalSvc bootstrap complete');
      return inst;
    } finally {
      RetrievalSvc.in_flight = null;
    }
  }
}
