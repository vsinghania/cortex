import type { GraphNotebook, GraphPageBatch, GraphSection, ListPagesParams } from '../types/graph.types.js';

/**
 * Read-only Microsoft Graph, scoped to what the sync needs. Every method takes the
 * caller's AbortSignal: a throttled call can sit in a Retry-After sleep, and a job
 * being cancelled or a worker draining must not wait it out.
 */
export interface GraphOneNoteAdapterInterface {
  listNotebooks(params?: { signal?: AbortSignal }): Promise<GraphNotebook[]>;

  /** Flat, with each section's notebook and section group expanded - one call, no walk. */
  listSections(params?: { signal?: AbortSignal }): Promise<GraphSection[]>;

  listPages(params: ListPagesParams): Promise<GraphPageBatch>;

  /** The page as OneNote's own HTML. */
  getPageContent(params: { page_id: string; signal?: AbortSignal }): Promise<string>;
}
