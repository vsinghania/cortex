import type { DocumentResolver, ResolvedDocuments } from './document_resolver_interface.js';
import type { Citation, CitationView } from './types/citation.types.js';
import { CitationExtractor } from './citation_extractor.js';
import { NotesDocumentResolver } from './corpora/notes_document_resolver.js';
import { Corpus } from '../retrieval_svc/types/retrieval.types.js';
import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';

/**
 * Owns the citation lifecycle: turning an answer's markers into stored citations, and
 * resolving those back into displayable references against live documents.
 *
 * Corpus routing mirrors RetrievalSvc - a Map keyed off each resolver's own `corpus`,
 * self-bootstrapped so there is no wiring step for a caller to forget.
 */
export class CitationSvc {
  private static instance: CitationSvc | null = null;
  private static in_flight: Promise<CitationSvc> | null = null;

  private resolvers = new Map<Corpus, DocumentResolver>();

  private constructor() {}

  static async getInstance(): Promise<CitationSvc> {
    if (CitationSvc.instance) return CitationSvc.instance;
    if (CitationSvc.in_flight) return CitationSvc.in_flight;
    CitationSvc.in_flight = CitationSvc.loadInstance();
    return CitationSvc.in_flight;
  }

  static async create(): Promise<CitationSvc> {
    return CitationSvc.getInstance();
  }

  static getExistingInstance(): CitationSvc | null {
    return CitationSvc.instance;
  }

  /** Pure and stateless, so it needs no instance. */
  static extract(params: { tool_payloads: unknown[]; answer_text?: string }): Citation[] {
    return CitationExtractor.extract(params);
  }

  register(resolver: DocumentResolver): void {
    if (this.resolvers.has(resolver.corpus)) {
      logger.warn(
        { corpus: resolver.corpus },
        'CitationSvc: document resolver already registered; replacing'
      );
    }
    this.resolvers.set(resolver.corpus, resolver);
    logger.info({ corpus: resolver.corpus }, 'CitationSvc: registered corpus');
  }

  listCorpora(): Corpus[] {
    return Array.from(this.resolvers.keys());
  }

  async resolve(params: { user_id: string; citations: Citation[] }): Promise<CitationView[]> {
    const [views] = await this.resolveGroups({ user_id: params.user_id, groups: [params.citations] });
    return views;
  }

  /**
   * Resolves several citation lists with one query pass per corpus, so a whole transcript
   * costs the same as a single message. Output groups line up with the input groups.
   */
  async resolveGroups(params: {
    user_id: string;
    groups: Citation[][];
  }): Promise<CitationView[][]> {
    const all = params.groups.flat();
    if (all.length === 0) return params.groups.map(() => []);

    const start_ms = performance.now();
    const resolved_by_corpus = await this.resolveByCorpus(params.user_id, all);
    const out = params.groups.map((group) =>
      group.map((citation) =>
        CitationSvc.toView(citation, resolved_by_corpus.get(citation.corpus))
      )
    );

    logger.debug(
      {
        citation_count: all.length,
        corpus_count: resolved_by_corpus.size,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'citations resolved'
    );
    return out;
  }

  private async resolveByCorpus(
    user_id: string,
    citations: Citation[]
  ): Promise<Map<Corpus, ResolvedDocuments>> {
    const by_corpus = new Map<Corpus, Citation[]>();
    for (const citation of citations) {
      const bucket = by_corpus.get(citation.corpus);
      if (bucket) bucket.push(citation);
      else by_corpus.set(citation.corpus, [citation]);
    }

    const entries = await Promise.all(
      Array.from(by_corpus.entries()).map(async ([corpus, group]) => {
        const resolver = this.resolvers.get(corpus);
        if (!resolver) {
          // Degrade rather than throw: one unregistered corpus must not fail a whole
          // conversation read. Its citations render as dead references.
          logger.warn({ corpus }, 'CitationSvc: no resolver registered for corpus');
          return null;
        }
        const resolved = await resolver.resolve({
          user_id,
          document_ids: Array.from(new Set(group.map((c) => c.document_id))),
          chunk_ids: Array.from(new Set(group.map((c) => c.chunk_id)))
        });
        return [corpus, resolved] as const;
      })
    );

    return new Map(entries.filter((e): e is NonNullable<typeof e> => e !== null));
  }

  private static toView(citation: Citation, resolved?: ResolvedDocuments): CitationView {
    const title = resolved?.titles.get(citation.document_id);
    return {
      ...citation,
      document_title: title ?? '(deleted)',
      heading_path: resolved?.heading_paths.get(citation.chunk_id),
      document_available: title !== undefined,
      chunk_available: resolved?.known_chunk_ids.has(citation.chunk_id) ?? false
    };
  }

  private static async loadInstance(): Promise<CitationSvc> {
    try {
      const inst = new CitationSvc();
      inst.register(new NotesDocumentResolver());
      CitationSvc.instance = inst;
      logger.info({ corpora: inst.listCorpora() }, 'CitationSvc bootstrap complete');
      return inst;
    } finally {
      CitationSvc.in_flight = null;
    }
  }
}
