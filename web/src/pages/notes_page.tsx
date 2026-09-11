import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../lib/api_client';
import type { Note, NoteCreateBody, NotePatchBody, NoteTagCount } from '../lib/note.types';
import { NoteForm } from '../components/note_form';
import { NoteRow } from '../components/note_row';
import { TagFilterBar } from '../components/tag_filter_bar';
import { EmptyState } from '../components/empty_state';
import { Icon } from '../components/icon';

const SKELETON_ROW_COUNT = 3;

function NoteListSkeleton() {
  return (
    <div className="notes-list" aria-busy="true" aria-label="Loading notes">
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
        <div key={i} className="note-row note-skeleton">
          <span className="skeleton-line" />
          <span className="skeleton-line" />
          <span className="skeleton-line" />
        </div>
      ))}
    </div>
  );
}

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

  // Refetches after a filter change keep the current list on screen (dimmed) instead of
  // collapsing it, so the page doesn't jump on every tag click.
  const is_initial_load = loading && notes.length === 0;
  const note_count_label = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;

  function renderList() {
    if (is_initial_load) return <NoteListSkeleton />;
    if (notes.length === 0 && active_tags.length > 0) {
      return (
        <EmptyState
          icon="search"
          title="Nothing matches"
          actions={<button type="button" onClick={() => set_active_tags([])}>Clear filters</button>}
        >
          No notes tagged {active_tags.map((t) => `"${t}"`).join(' + ')}.
        </EmptyState>
      );
    }
    if (notes.length === 0) {
      return (
        <EmptyState icon="notes" title="No notes yet">
          Capture your first note. Cortex indexes it so you can ask about it in Chat.
        </EmptyState>
      );
    }
    return (
      <div className={`notes-list${loading ? ' notes-list-refreshing' : ''}`} aria-busy={loading}>
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
    );
  }

  return (
    <div className="page notes-page">
      <header className="page-header">
        <div>
          <h1>Notes</h1>
          {!is_initial_load && notes.length > 0 && (
            <p className="page-subtitle">
              {active_tags.length > 0 ? `${note_count_label} matching filters` : note_count_label}
            </p>
          )}
        </div>
        {!show_create && (
          <button type="button" className="primary" onClick={() => set_show_create(true)}>
            <Icon name="plus" size={15} />
            New note
          </button>
        )}
      </header>

      {show_create && (
        <section className="note-create">
          <NoteForm
            submit_label="Create note"
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

      {error && <div className="page-error" role="alert">{error}</div>}

      {renderList()}
    </div>
  );
}
