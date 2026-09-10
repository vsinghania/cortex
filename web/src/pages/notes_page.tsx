import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../lib/api_client';
import type { Note, NoteCreateBody, NotePatchBody, NoteTagCount } from '../lib/note.types';
import { NoteForm } from '../components/note_form';
import { NoteRow } from '../components/note_row';
import { TagFilterBar } from '../components/tag_filter_bar';
import { Spinner } from '../components/spinner';

export function NotesPage() {
  const [notes, set_notes] = useState<Note[]>([]);
  const [tag_counts, set_tag_counts] = useState<NoteTagCount[]>([]);
  const [active_tags, set_active_tags] = useState<string[]>([]);
  const [loading, set_loading] = useState(true);
  const [show_create, set_show_create] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    set_loading(true);
    set_error(null);
    try {
      const res = await ApiClient.listNotes({ limit: 100, tags: active_tags });
      set_notes(res.items);
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to load notes.');
    } finally {
      set_loading(false);
    }
  }, [active_tags]);

  const refetchTags = useCallback(async () => {
    try {
      const res = await ApiClient.listNoteTags();
      set_tag_counts(res.tags);
    } catch {
      // A failed facet load only costs the filter bar; the notes list still renders.
      set_tag_counts([]);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    void refetchTags();
  }, [refetchTags]);

  function toggleTag(tag: string) {
    set_active_tags((current) => {
      const without = current.filter((t) => t.toLowerCase() !== tag.toLowerCase());
      return without.length === current.length ? [...current, tag] : without;
    });
  }

  // Writes can add or remove tags, so the facet counts have to be refreshed alongside the list.
  async function refetchAll() {
    await Promise.all([refetch(), refetchTags()]);
  }

  async function handleCreate(body: NoteCreateBody | NotePatchBody) {
    await ApiClient.createNote(body as NoteCreateBody);
    set_show_create(false);
    await refetchAll();
  }

  async function handleUpdate(id: string, body: NotePatchBody) {
    await ApiClient.updateNote(id, body);
    await refetchAll();
  }

  async function handleDelete(id: string) {
    await ApiClient.deleteNote(id);
    await refetchAll();
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

      <TagFilterBar
        tags={tag_counts}
        active_tags={active_tags}
        onToggle={toggleTag}
        onClear={() => set_active_tags([])}
      />

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <Spinner label="Loading notes…" />
      ) : notes.length === 0 ? (
        active_tags.length > 0 ? (
          <p className="empty-state">
            No notes tagged {active_tags.map((t) => `"${t}"`).join(' + ')}.
          </p>
        ) : (
          <p className="empty-state">No notes yet. Click "+ New note" to add one.</p>
        )
      ) : (
        <div className="notes-list">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onTagClick={toggleTag}
              active_tags={active_tags}
            />
          ))}
        </div>
      )}
    </div>
  );
}
