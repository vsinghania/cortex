import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import type { Note, NotePatchBody } from '../lib/note.types';
import { NoteForm } from '../components/note_form';
import { Spinner } from '../components/spinner';

export function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [note, set_note] = useState<Note | null>(null);
  const [loading, set_loading] = useState(true);
  const [editing, set_editing] = useState(false);
  const [error, set_error] = useState<string | null>(null);

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
          <pre className="note-detail-body">{note.body}</pre>
          <footer className="note-row-meta">
            Created {new Date(note.created_at).toLocaleString()} · Updated {new Date(note.updated_at).toLocaleString()}
          </footer>
        </article>
      )}
    </div>
  );
}
