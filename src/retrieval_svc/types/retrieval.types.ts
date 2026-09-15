/**
 * Generic retrieval primitives shared across corpora (notes, chats, voice transcripts, ...).
 *
 * Two shapes:
 *   RawRetrievedChunk — what retrieval_svc returns. Derived from the corpus's chunk + vector
 *                       stores only; no parent-document lookups.
 *   RetrievedChunk    — RawRetrievedChunk decorated by the domain svc (e.g. notes_svc) with
 *                       document-level fields like `document_title`. This is the shape API
 *                       consumers and the MCP tool see.
 */

export enum Corpus {
  Notes = 'notes',
  Chats = 'chats',
  Voice = 'voice'
}

export type RawRetrievedChunk = {
  chunk_id: string;
  /** Stable id of the source document (note id, chat id, transcript id, ...). */
  document_id: string;
  corpus: Corpus;
  /** Provider tag from the vector payload (e.g. NoteSource value for notes). Opaque to retrieval_svc. */
  source: string;
  chunk_index: number;
  heading_path?: string[];
  snippet: string;
  score: number;
};

export type RetrievedChunk = RawRetrievedChunk & {
  document_title: string;
};

export type RetrieveParams = {
  user_id: string;
  question: string;
  top_k?: number;
  /** Corpus-specific filter values (e.g. allowed note sources). */
  source_filter?: string[];
  /** Archived documents are left out of retrieval unless this is set. */
  include_archived?: boolean;
};
