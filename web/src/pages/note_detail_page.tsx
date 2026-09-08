import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import type { Note, NoteChunkRef, NotePatchBody } from '../lib/note.types';
import { NoteForm } from '../components/note_form';
import { Spinner } from '../components/spinner';

type HighlightRange = { start: number; end: number };

/**
 * Chunk content is not a guaranteed substring of the body (headings are dropped, blank
 * lines collapse, oversized blocks round-trip through the tokenizer), so offsets are the
 * primary anchor and a literal search is the fallback for chunks written before offsets
 * existed.
 */
function resolveHighlight(body: string, chunk: NoteChunkRef | null): HighlightRange | null {
  if (!chunk) return null;

  const { start_offset, end_offset } = chunk;
  if (
    start_offset != null &&
    end_offset != null &&
    start_offset >= 0 &&
    end_offset > start_offset &&
    end_offset <= body.length
  ) {
    return { start: start_offset, end: end_offset };
  }

  const found = body.indexOf(chunk.content);
  if (found !== -1) return { start: found, end: found + chunk.content.length };

  return null;
}

export function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [search_params] = useSearchParams();
  const chunk_id = search_params.get('chunk');
  const navigate = useNavigate();
  const [note, set_note] = useState<Note | null>(null);
  const [chunk, set_chunk] = useState<NoteChunkRef | null>(null);
  const [loading, set_loading] = useState(true);
  const [editing, set_editing] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const highlight_ref = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    set_loading(true);
    set_error(null);
    try {
      const res = await ApiClient.getNote(id);
      set_note(res.note);
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to load note.');
    } finally {
      set_loading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!id || !chunk_id) {
      set_chunk(null);
      return;
    }
    let cancelled = false;
    const loadChunk = async () => {
      try {
        const res = await ApiClient.getNoteChunk(id, chunk_id);
        if (!cancelled) set_chunk(res.chunk);
      } catch {
        // A pruned or unknown chunk just means no highlight; the note still renders.
        if (!cancelled) set_chunk(null);
      }
    };
    void loadChunk();
    return () => {
      cancelled = true;
    };
  }, [id, chunk_id]);

  const highlight = note && !editing ? resolveHighlight(note.body, chunk) : null;

  useEffect(() => {
    if (!highlight) return;
    highlight_ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight?.start, highlight?.end]);

  async function handleSave(body: NotePatchBody) {
    if (!id) return;
    const res = await ApiClient.updateNote(id, body);
    set_note(res.note);
    set_editing(false);
  }

  async function handleDelete() {
    if (!id || !note) return;
    if (!window.confirm(`Delete "${note.title}"?`)) return;
    await ApiClient.deleteNote(id);
    navigate('/notes', { replace: true });
  }

  if (loading) return <div className="page"><Spinner label="Loading…" /></div>;
  if (error) return <div className="page"><div className="page-error">{error}</div></div>;
  if (!note) return <div className="page"><p>Not found.</p></div>;

  return (
    <div className="page note-detail-page">
      <header className="page-header">
        <Link to="/notes" className="back-link">← All notes</Link>
        {!editing && (
          <div className="page-header-actions">
            <button type="button" onClick={() => set_editing(true)}>Edit</button>
            <button type="button" onClick={handleDelete} className="danger">Delete</button>
          </div>
        )}
      </header>

      {editing ? (
        <NoteForm
          initial={note}
          submit_label="Save"
          onSubmit={handleSave}
          onCancel={() => set_editing(false)}
        />
      ) : (
        <article className="note-detail">
          <h1>{note.title}</h1>
          {note.tags.length > 0 && (
            <div className="note-row-tags">
              {note.tags.map((t) => (
                <span key={t} className="tag-chip">{t}</span>
              ))}
            </div>
          )}
          <pre className="note-detail-body">
            {highlight ? (
              <>
                {note.body.slice(0, highlight.start)}
                <mark className="note-highlight" ref={highlight_ref}>
                  {note.body.slice(highlight.start, highlight.end)}
                </mark>
                {note.body.slice(highlight.end)}
              </>
            ) : (
              note.body
            )}
          </pre>
          <footer className="note-row-meta">
            Created {new Date(note.created_at).toLocaleString()} · Updated {new Date(note.updated_at).toLocaleString()}
          </footer>
        </article>
      )}
    </div>
  );
}
