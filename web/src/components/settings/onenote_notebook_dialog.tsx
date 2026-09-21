import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../../lib/api_client';
import { ConfirmDialog } from '../confirm_dialog';
import type { OneNoteNotebook } from '../../lib/onenote.types';

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
}

/**
 * Choosing notebooks is a setup task, done once and rarely revisited, so it lives behind
 * a dialog rather than sitting on the card. A dialog also makes staged edits obvious:
 * changes apply on Save, and Cancel drops them.
 */
export function OneNoteNotebookDialog({
  open,
  onClose,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notebooks, set_notebooks] = useState<OneNoteNotebook[] | null>(null);
  const [chosen, set_chosen] = useState<string[]>([]);
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    set_busy(true);
    set_error(null);
    try {
      const { notebooks: list } = await ApiClient.getOneNoteNotebooks(refresh);
      set_notebooks(list);
      set_chosen(list.filter((n) => n.selected).map((n) => n.id));
    } catch {
      set_error("We couldn't load your notebooks from Microsoft.");
    } finally {
      set_busy(false);
    }
  }, []);

  // Re-read on each open: a notebook made since the last visit should be here.
  useEffect(() => {
    if (open) void load(false);
  }, [open, load]);

  const saved_ids = useMemo(() => (notebooks ?? []).filter((n) => n.selected).map((n) => n.id), [notebooks]);
  const dirty = !sameIds(chosen, saved_ids);

  const toggle = (id: string) =>
    set_chosen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  async function save() {
    if (!dirty) {
      onClose();
      return;
    }
    set_busy(true);
    set_error(null);
    try {
      await ApiClient.selectOneNoteNotebooks(chosen);
      onSaved();
      onClose();
    } catch {
      set_error("We couldn't save that change.");
      set_busy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title="Choose notebooks"
      confirm_label="Save"
      busy={busy}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <div className="notebook-chooser">
        <div className="notebook-chooser-head">
          <span className="connection-meta">
            {notebooks ? `${chosen.length} of ${notebooks.length} selected` : 'Loading…'}
          </span>
          <button type="button" className="text-link" disabled={busy} onClick={() => void load(true)}>
            Refresh
          </button>
        </div>

        {notebooks?.length === 0 && <p className="connection-meta">This account has no notebooks.</p>}

        {notebooks && notebooks.length > 0 && (
          <ul className="notebook-choices">
            {notebooks.map((notebook) => (
              <li key={notebook.id}>
                <label className="notebook-choice">
                  <input type="checkbox" checked={chosen.includes(notebook.id)} onChange={() => toggle(notebook.id)} />
                  <span className="notebook-choice-name">{notebook.display_name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="connection-error">{error}</p>}
        <p className="connection-meta">
          Unticking a notebook stops future syncs. Notes already imported stay in Cortex.
        </p>
      </div>
    </ConfirmDialog>
  );
}
