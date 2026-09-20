import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../../lib/api_client';
import type { OneNoteNotebook } from '../../lib/onenote.types';

/**
 * Nothing syncs until something here is ticked, so this doubles as the setup step on a
 * fresh connection rather than being a refinement of a default.
 */
export function OneNoteNotebookPicker({ onChanged }: { onChanged?: (count: number) => void }) {
  const [notebooks, set_notebooks] = useState<OneNoteNotebook[] | null>(null);
  const [saving, set_saving] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { notebooks: list } = await ApiClient.getOneNoteNotebooks();
        if (!cancelled) set_notebooks(list);
      } catch {
        if (!cancelled) set_error("We couldn't load your notebooks from Microsoft.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    async (id: string) => {
      if (!notebooks) return;
      const next = notebooks.map((n) => (n.id === id ? { ...n, selected: !n.selected } : n));
      // Optimistic: the checkbox should not lag a round trip behind the pointer.
      set_notebooks(next);
      set_saving(true);
      set_error(null);

      const chosen = next.filter((n) => n.selected).map((n) => n.id);
      try {
        await ApiClient.selectOneNoteNotebooks(chosen);
        onChanged?.(chosen.length);
      } catch {
        set_notebooks(notebooks);
        set_error("We couldn't save that change.");
      } finally {
        set_saving(false);
      }
    },
    [notebooks, onChanged]
  );

  if (error && !notebooks) return <p className="connection-error">{error}</p>;
  if (!notebooks) return <p className="connection-meta">Loading notebooks…</p>;
  if (notebooks.length === 0) return <p className="connection-meta">This account has no notebooks.</p>;

  return (
    <div className="notebook-picker">
      <p className="connection-meta">Notebooks to sync</p>
      <ul className="notebook-list">
        {notebooks.map((notebook) => (
          <li key={notebook.id}>
            <label className="notebook-item">
              <input
                type="checkbox"
                checked={notebook.selected}
                disabled={saving}
                onChange={() => void toggle(notebook.id)}
              />
              <span>{notebook.display_name}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="connection-error">{error}</p>}
      <p className="connection-meta">
        Unticking a notebook stops future syncs. Notes already imported stay in Cortex.
      </p>
    </div>
  );
}
