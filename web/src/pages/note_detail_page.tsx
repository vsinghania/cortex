import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import type { Note, NoteChunkRef, NotePatchBody } from '../lib/note.types';
import type { ReturnLinkState } from '../lib/navigation.types';
import { DateFormat } from '../lib/date_format';
import { NoteForm } from '../components/note_form';
import { EmptyState } from '../components/empty_state';
import { Icon } from '../components/icon';
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
  const return_link = useLocation().state as ReturnLinkState | null;
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

  const back_link = (
    <Link to={return_link?.return_to ?? '/notes'} className="back-link">
      <Icon name="back" size={15} />
      {return_link?.return_label ?? 'All notes'}
    </Link>
  );

  if (loading) return <div className="page"><Spinner label="Loading…" /></div>;
  if (error) {
    return (
      <div className="page note-detail-page">
        <header className="page-header">{back_link}</header>
        <div className="page-error" role="alert">{error}</div>
      </div>
    );
  }
  if (!note) {
    return (
      <div className="page note-detail-page">
        <header className="page-header">{back_link}</header>
        <EmptyState icon="notes" title="Note not found">
          It may have been deleted.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page note-detail-page">
      <header className="page-header">
        {back_link}
        {!editing && (
          <div className="page-header-actions">
            <button type="button" className="ghost" onClick={() => set_editing(true)}>
              <Icon name="edit" size={15} />
              Edit
            </button>
            <button type="button" className="ghost danger" onClick={handleDelete}>
              <Icon name="trash" size={15} />
              Delete
            </button>
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
          <h1 className="note-detail-title">{note.title}</h1>
          <div className="note-detail-meta">
            {note.tags.length > 0 && (
              <div className="note-row-tags">
                {note.tags.map((t) => (
                  <span key={t} className="tag-chip">{t}</span>
                ))}
              </div>
            )}
            <span className="note-detail-dates">
              Created {DateFormat.full(note.created_at)} · Updated {DateFormat.relative(note.updated_at)}
            </span>
          </div>
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
        </article>
      )}
    </div>
  );
}
