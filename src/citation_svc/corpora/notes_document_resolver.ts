import type { DocumentResolver, ResolvedDocuments } from '../document_resolver_interface.js';
import { Corpus } from '../../retrieval_svc/types/retrieval.types.js';
import { NotesSvc } from '../../notes_svc/notes_svc.js';

/**
 * Backs citations that point at notes. Both lookups are user-scoped in their repo queries,
 * so a citation can never resolve a document belonging to someone else.
 */
export class NotesDocumentResolver implements DocumentResolver {
  readonly corpus = Corpus.Notes;

  async resolveDocuments(params: {
    user_id: string;
    document_ids: string[];
    chunk_ids: string[];
  }): Promise<ResolvedDocuments> {
    // NotesSvc is per-request by convention, so it is built here rather than held as state.
    const notes_svc = await NotesSvc.create();
    const [notes, chunks] = await Promise.all([
      notes_svc.getNotesByIds({ user_id: params.user_id, ids: params.document_ids }),
      notes_svc.getChunksByIds({ user_id: params.user_id, ids: params.chunk_ids })
    ]);

    return {
      titles: new Map(notes.map((n) => [n.id, n.title])),
      heading_paths: new Map(
        chunks
          .filter((c): c is typeof c & { heading_path: string[] } => !!c.heading_path)
          .map((c) => [c.id, c.heading_path])
      ),
      known_chunk_ids: new Set(chunks.map((c) => c.id))
    };
  }
}
