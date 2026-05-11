import { useState } from 'react';
import type { Note, NoteCreateBody, NotePatchBody } from '../lib/note.types';

type Props = {
  initial?: Pick<Note, 'title' | 'body' | 'tags'>;
  submit_label?: string;
  cancel_label?: string;
  onSubmit: (body: NoteCreateBody | NotePatchBody) => Promise<void>;
  onCancel?: () => void;
};

export function NoteForm({ initial, submit_label = 'Save', cancel_label = 'Cancel', onSubmit, onCancel }: Props) {
  const [title, set_title] = useState(initial?.title ?? '');
  const [body, set_body] = useState(initial?.body ?? '');
  const [tags_text, set_tags_text] = useState((initial?.tags ?? []).join(', '));
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      set_error('Title is required.');
      return;
    }
    set_submitting(true);
    set_error(null);
    const tags = tags_text
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    try {
      await onSubmit({ title: title.trim(), body, tags });
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to save note.');
    } finally {
      set_submitting(false);
    }
  }

  return (
    <form className="note-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => set_title(e.target.value)}
        disabled={submitting}
        className="note-form-title"
      />
      <textarea
        placeholder="Write your note (markdown supported)…"
        value={body}
        onChange={(e) => set_body(e.target.value)}
        disabled={submitting}
        className="note-form-body"
        rows={8}
      />
      <input
        type="text"
        placeholder="Tags, comma-separated"
        value={tags_text}
        onChange={(e) => set_tags_text(e.target.value)}
        disabled={submitting}
        className="note-form-tags"
      />
      {error && <div className="form-error">{error}</div>}
      <div className="note-form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : submit_label}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={submitting} className="secondary">
            {cancel_label}
          </button>
        )}
      </div>
    </form>
  );
}
