import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Note, NotePatchBody } from '../lib/note.types';
import { DateFormat } from '../lib/date_format';
import { NotePreview } from '../lib/note_preview';
import { NoteForm } from './note_form';
import { Icon } from './icon';

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

  const preview = NotePreview.excerpt(note);

  return (
    <article className="note-row">
      <header className="note-row-header">
        <h3 className="note-row-title">
          <Link to={`/notes/${note.id}`}>{note.title}</Link>
        </h3>
        <div className="note-row-actions">
          <button
            type="button"
            className="ghost icon-button"
            onClick={() => set_editing(true)}
            title="Edit"
            aria-label={`Edit "${note.title}"`}
          >
            <Icon name="edit" size={15} />
          </button>
          <button
            type="button"
            className="ghost danger icon-button"
            onClick={handleDelete}
            disabled={deleting}
            aria-busy={deleting}
            title="Delete"
            aria-label={`Delete "${note.title}"`}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </header>
      {preview && <p className="note-row-preview">{preview}</p>}
      <footer className="note-row-footer">
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
        <time className="note-row-meta" dateTime={note.created_at} title={DateFormat.full(note.created_at)}>
          {DateFormat.relative(note.created_at)}
        </time>
      </footer>
    </article>
  );
}
