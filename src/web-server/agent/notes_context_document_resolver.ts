import type { ContextDocumentResolverInterface } from '../../agent_svc/context/context_document_resolver_interface.js';
import type { ContextDocument } from '../../agent_svc/types/context_document.types.js';
import { Corpus } from '../../retrieval_svc/types/retrieval.types.js';
import { NotesSvc } from '../../notes_svc/notes_svc.js';

/** Attaches a note to a chat. The lookup is user-scoped, so a thread can only carry the caller's own notes. */
export class NotesContextDocumentResolver implements ContextDocumentResolverInterface {
  readonly corpus = Corpus.Notes;

  async resolve(params: { user_id: string; document_id: string }): Promise<ContextDocument | null> {
    // NotesSvc is per-request by convention, so it is built here rather than held as state.
    const notes_svc = await NotesSvc.create();
    const note = await notes_svc.getNote(params.user_id, { id: params.document_id });
    if (!note || note.is_deleted) return null;
    return {
      corpus: this.corpus,
      document_id: note.id,
      title: note.title,
      body: note.body,
    };
  }
}
