import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../lib/api_client';
import type { Note, NoteCreateBody, NotePatchBody } from '../lib/note.types';
import { NoteForm } from '../components/note_form';
import { NoteRow } from '../components/note_row';
import { Spinner } from '../components/spinner';

export function NotesPage() {
  const [notes, set_notes] = useState<Note[]>([]);
  const [loading, set_loading] = useState(true);
  const [show_create, set_show_create] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    set_loading(true);
    set_error(null);
    try {
      const res = await ApiClient.listNotes({ limit: 100 });
      set_notes(res.items);
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to load notes.');
    } finally {
      set_loading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function handleCreate(body: NoteCreateBody | NotePatchBody) {
    await ApiClient.createNote(body as NoteCreateBody);
    set_show_create(false);
    await refetch();
  }

  async function handleUpdate(id: string, body: NotePatchBody) {
    await ApiClient.updateNote(id, body);
    await refetch();
  }

  async function handleDelete(id: string) {
    await ApiClient.deleteNote(id);
    await refetch();
  }

  return (
    <div className="page notes-page">
      <header className="page-header">
        <h1>Notes</h1>
        {!show_create && (
          <button type="button" onClick={() => set_show_create(true)}>+ New note</button>
        )}
      </header>

      {show_create && (
        <section className="note-create">
          <NoteForm
            submit_label="Create"
            onSubmit={handleCreate}
            onCancel={() => set_show_create(false)}
          />
        </section>
      )}

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <Spinner label="Loading notes…" />
      ) : notes.length === 0 ? (
        <p className="empty-state">No notes yet. Click "+ New note" to add one.</p>
      ) : (
        <div className="notes-list">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
