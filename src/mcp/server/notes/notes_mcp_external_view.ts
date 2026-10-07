import type { Note } from '../../../notes_svc/types/note.types.js';
import type { RetrievedChunk } from '../../../retrieval_svc/types/retrieval.types.js';
import type { NoteLinks } from './note_links.js';

/**
 * What an external assistant sees of a note. Models echo what they are handed, so
 * bookkeeping (vectorization, sync state, provider metadata, the raw transcript) stays
 * out, and every note carries a link the assistant can cite.
 */
export type ExternalNote = Pick<
  Note,
  'id' | 'title' | 'body' | 'tags' | 'folder_id' | 'source' | 'is_archived' | 'is_pinned' | 'edited_at' | 'created_at'
> & { url?: string };

export type ExternalChunk = RetrievedChunk & { url?: string };

export class NotesMcpExternalView {
  private constructor() {}

  static note(note: Note, links: NoteLinks | null): ExternalNote {
    return {
      id: note.id,
      title: note.title,
      body: note.body,
      tags: note.tags,
      folder_id: note.folder_id,
      source: note.source,
      is_archived: note.is_archived,
      is_pinned: note.is_pinned,
      edited_at: note.edited_at,
      created_at: note.created_at,
      ...(links ? { url: links.note(note.id) } : {})
    };
  }

  static chunk(chunk: RetrievedChunk, links: NoteLinks | null): ExternalChunk {
    return links ? { ...chunk, url: links.chunk(chunk.document_id, chunk.chunk_id) } : chunk;
  }
}
