import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../../lib/api_client';
import { DateFormat } from '../../lib/date_format';
import { Icon } from '../icon';
import type { OneNoteNotebook } from '../../lib/onenote.types';

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
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
  const select_all = useRef<HTMLInputElement>(null);

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
  const all_chosen = !!notebooks?.length && chosen.length === notebooks.length;

  // "Some but not all" has no checked value of its own; it has to be set on the node.
  useEffect(() => {
    if (select_all.current) select_all.current.indeterminate = chosen.length > 0 && !all_chosen;
  }, [chosen.length, all_chosen]);

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
        <p className="connection-meta">
          {notebooks.length} notebook{notebooks.length === 1 ? '' : 's'} · {chosen.length} selected
        </p>
        <div className="notebook-actions">
          {dirty && <span className="notebook-dirty">Unsaved</span>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load(true)}>
            <Icon name="refresh" size={13} />
            Refresh list
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {notebooks.length === 0 ? (
        <p className="connection-meta">This account has no notebooks.</p>
      ) : (
        <div className="notebook-table-wrap">
          <table className="notebook-table">
            <thead>
              <tr>
                <th scope="col" className="notebook-col-check">
                  <input
                    ref={select_all}
                    type="checkbox"
                    checked={all_chosen}
                    aria-label="Select all notebooks"
                    onChange={() => set_chosen(all_chosen ? [] : notebooks.map((n) => n.id))}
                  />
                </th>
                <th scope="col">Notebook</th>
                <th scope="col" className="notebook-col-synced">Last synced</th>
                <th scope="col" className="notebook-col-action">
                  <span className="sr-only">Sync</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {notebooks.map((notebook) => {
                // A null scope means the running pass covers every notebook.
                const syncing = syncing_ids === null || !!syncing_ids?.includes(notebook.id);
                const ticked = chosen.includes(notebook.id);
                const row_id = `notebook-${notebook.id}`;

                return (
                  <tr key={notebook.id} className={ticked ? 'is-selected' : undefined}>
                    <td className="notebook-col-check">
                      <input id={row_id} type="checkbox" checked={ticked} onChange={() => toggle(notebook.id)} />
                    </td>
                    <td className="notebook-name">
                      <label htmlFor={row_id}>{notebook.display_name}</label>
                    </td>
                    <td className="notebook-col-synced">
                      {syncing ? (
                        <span className="notebook-syncing">Syncing…</span>
                      ) : notebook.last_synced_at ? (
                        <span title={DateFormat.full(notebook.last_synced_at)}>
                          {DateFormat.relative(notebook.last_synced_at)}
                        </span>
                      ) : (
                        // Nothing to say for a notebook nobody asked to sync.
                        <span className="notebook-muted">{notebook.selected ? 'Not yet' : '—'}</span>
                      )}
                    </td>
                    <td className="notebook-col-action">
                      {notebook.selected && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm"
                          disabled={syncing || dirty}
                          aria-label={`Sync ${notebook.display_name}`}
                          title={dirty ? 'Save your changes first' : `Sync ${notebook.display_name}`}
                          onClick={() => onSyncNotebook(notebook.id)}
                        >
                          <Icon name="refresh" size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="connection-error">{error}</p>}
      {chosen.length === 0 && (
        <p className="connection-meta">Tick the notebooks you want in Cortex, then save.</p>
      )}
    </div>
  );
}
