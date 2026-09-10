import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Note, NotePatchBody } from '../lib/note.types';
import { NoteForm } from './note_form';

type Props = {
  note: Note;
  onUpdate: (id: string, body: NotePatchBody) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTagClick?: (tag: string) => void;
  active_tags?: string[];
};

export function NoteRow({ note, onUpdate, onDelete, onTagClick, active_tags = [] }: Props) {
  const [editing, set_editing] = useState(false);
  const [deleting, set_deleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete "${note.title}"?`)) return;
    set_deleting(true);
    try {
      await onDelete(note.id);
    } finally {
      set_deleting(false);
    }
  }

  if (editing) {
    return (
      <div className="note-row note-row-editing">
        <NoteForm
          initial={note}
          submit_label="Save"
          onSubmit={async (body) => {
            await onUpdate(note.id, body);
            set_editing(false);
          }}
          onCancel={() => set_editing(false)}
        />
      </div>
    );
  }

  const preview = note.body.length > 200 ? `${note.body.slice(0, 200)}…` : note.body;

  return (
    <article className="note-row">
      <header className="note-row-header">
        <h3 className="note-row-title">
          <Link to={`/notes/${note.id}`}>{note.title}</Link>
        </h3>
        <div className="note-row-actions">
          <button type="button" onClick={() => set_editing(true)}>Edit</button>
          <button type="button" onClick={handleDelete} disabled={deleting} className="danger">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </header>
      {preview && <p className="note-row-preview">{preview}</p>}
      {note.tags.length > 0 && (
        <div className="note-row-tags">
          {note.tags.map((t) => {
            const is_active = active_tags.some((a) => a.toLowerCase() === t.toLowerCase());
            const class_name = `tag-chip${is_active ? ' tag-chip-active' : ''}`;
            return onTagClick ? (
              <button
                key={t}
                type="button"
                className={class_name}
                aria-pressed={is_active}
                onClick={() => onTagClick(t)}
              >
                {t}
              </button>
            ) : (
              <span key={t} className={class_name}>{t}</span>
            );
          })}
        </div>
      )}
      <footer className="note-row-meta">
        {new Date(note.created_at).toLocaleString()}
      </footer>
    </article>
  );
}
