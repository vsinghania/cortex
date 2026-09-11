import { useState } from 'react';
import type { Note, NoteCreateBody, NotePatchBody } from '../lib/note.types';
import { Platform } from '../lib/platform';

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

  function handleKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.requestSubmit();
    } else if (e.key === 'Escape' && onCancel && !submitting) {
      onCancel();
    }
  }

  return (
    <form className="note-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <input
        type="text"
        placeholder="Untitled note"
        aria-label="Title"
        value={title}
        onChange={(e) => set_title(e.target.value)}
        disabled={submitting}
        className="note-form-title"
        autoFocus
      />
      <textarea
        placeholder="Write your note…"
        aria-label="Body"
        value={body}
        onChange={(e) => set_body(e.target.value)}
        disabled={submitting}
        className="note-form-body"
        rows={8}
      />
      <input
        type="text"
        placeholder="Tags, comma-separated"
        aria-label="Tags"
        value={tags_text}
        onChange={(e) => set_tags_text(e.target.value)}
        disabled={submitting}
        className="note-form-tags"
      />
      {error && <div className="form-error">{error}</div>}
      <div className="note-form-footer">
        <span className="note-form-hint">
          Markdown supported · <kbd className="kbd">{Platform.modifierKeyLabel()}</kbd>
          <kbd className="kbd">Enter</kbd> to save
        </span>
        <div className="note-form-actions">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={submitting} className="ghost">
              {cancel_label}
            </button>
          )}
          <button type="submit" disabled={submitting} className="primary">
            {submitting ? 'Saving…' : submit_label}
          </button>
        </div>
      </div>
    </form>
  );
}
