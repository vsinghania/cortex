import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../../lib/api_client';
import { Icon } from '../icon';
import type { OneNoteNotebook } from '../../lib/onenote.types';

function formatSynced(iso: string | undefined): string {
  if (!iso) return 'never synced';
  const at = new Date(iso);
  const today = new Date().toDateString() === at.toDateString();
  return today
    ? `synced ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : `synced ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
}

export type NotebookPickerProps = {
  /** Notebooks the running sync covers; null means all, undefined means nothing running. */
  syncing_ids?: string[] | null;
  onSyncNotebook: (notebook_id: string) => void;
  onSaved: () => void;
};

/**
 * Nothing syncs until something here is ticked and saved, so this doubles as the setup
 * step on a fresh connection rather than being a refinement of a default.
 */
export function OneNoteNotebookPicker({ syncing_ids, onSyncNotebook, onSaved }: NotebookPickerProps) {
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

  useEffect(() => {
    void load(false);
  }, [load]);

  const saved_ids = useMemo(() => (notebooks ?? []).filter((n) => n.selected).map((n) => n.id), [notebooks]);
  const dirty = !sameIds(chosen, saved_ids);

  const toggle = (id: string) =>
    set_chosen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  async function save() {
    set_busy(true);
    set_error(null);
    try {
      await ApiClient.selectOneNoteNotebooks(chosen);
      set_notebooks((current) => current?.map((n) => ({ ...n, selected: chosen.includes(n.id) })) ?? null);
      onSaved();
    } catch {
      set_error("We couldn't save that change.");
    } finally {
      set_busy(false);
    }
  }

  if (error && !notebooks) return <p className="connection-error">{error}</p>;
  if (!notebooks) return <p className="connection-meta">Loading notebooks…</p>;

  return (
    <div className="notebook-picker">
      <div className="notebook-head">
        <p className="connection-meta">Notebooks to sync</p>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load(true)}>
          <Icon name="refresh" size={13} />
          Refresh list
        </button>
      </div>

      {notebooks.length === 0 ? (
        <p className="connection-meta">This account has no notebooks.</p>
      ) : (
        <ul className="notebook-list">
          {notebooks.map((notebook) => {
            // null scope means the running pass covers every notebook.
            const syncing = syncing_ids === null || syncing_ids?.includes(notebook.id);
            return (
              <li key={notebook.id} className="notebook-row">
                <label className="notebook-item">
                  <input type="checkbox" checked={chosen.includes(notebook.id)} onChange={() => toggle(notebook.id)} />
                  <span className="notebook-name">{notebook.display_name}</span>
                </label>
                <span className="notebook-status">
                  {syncing ? 'Syncing…' : formatSynced(notebook.last_synced_at)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!notebook.selected || syncing || dirty}
                  title={
                    !notebook.selected
                      ? 'Tick and save this notebook first'
                      : dirty
                        ? 'Save your changes first'
                        : 'Sync just this notebook'
                  }
                  onClick={() => onSyncNotebook(notebook.id)}
                >
                  Sync
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="connection-error">{error}</p>}

      <div className="notebook-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {dirty && <span className="connection-meta">Unsaved changes</span>}
      </div>

      <p className="connection-meta">
        Unticking a notebook stops future syncs. Notes already imported stay in Cortex.
      </p>
    </div>
  );
}
