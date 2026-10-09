import { z } from 'zod';
import { Corpus } from '../../retrieval_svc/types/retrieval.types.js';

/**
 * A resolved [c:<chunk_id>] marker from an agent answer.
 *
 * Identity only. Presentation fields (document title, heading path) are deliberately NOT
 * stored: they are mutable properties of the source document and would go stale the moment
 * it is edited. CitationSvc.resolveCitations joins them from live data on the way out.
 *
 * `index` is safe to store because it is a property of the answer text, which never
 * changes. `document_id` is stored alongside `chunk_id` because re-indexing prunes chunks:
 * a citation whose chunk is gone can still link to its document.
 */
export const CitationSchema = z.object({
  /** 1-based, ordered by first appearance in the answer text. */
  index: z.number().int().positive(),
  chunk_id: z.string().min(1),
  document_id: z.string().min(1),
  corpus: z.nativeEnum(Corpus),
});

export type Citation = z.infer<typeof CitationSchema>;

/**
 * Response-only projection: a stored Citation joined with live document data on the way
 * out. Never persisted - the presentation fields below have no write path, so renaming a
 * document updates every past answer that cited it on the next read.
 */
export type CitationView = Citation & {
  document_title: string;
  heading_path?: string[];
  /** False when the document has been deleted; the client renders it as a dead reference. */
  document_available: boolean;
  /** False when re-indexing pruned the chunk; the document link still works, minus the highlight. */
  chunk_available: boolean;
};
