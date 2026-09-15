import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type Props = {
  initial?: string;
  depth: number;
  placeholder: string;
  /** Resolves false when the save failed, so the input stays open with the name intact. */
  onCommit: (name: string) => Promise<boolean>;
  onCancel: () => void;
};

export function FolderNameInput({ initial = '', depth, placeholder, onCommit, onCancel }: Props) {
  const [value, set_value] = useState(initial);
  const [saving, set_saving] = useState(false);
  // Enter commits and disabling the input then blurs it; without this the blur commits again.
  const committing_ref = useRef(false);

  async function commit() {
    if (committing_ref.current) return;
    const name = value.trim();
    if (!name || name === initial) {
      onCancel();
      return;
    }
    committing_ref.current = true;
    set_saving(true);
    const ok = await onCommit(name);
    if (!ok) {
      committing_ref.current = false;
      set_saving(false);
    }
  }

  return (
    <div className="tree-row" style={{ '--depth': depth } as CSSProperties}>
      <input
        className="tree-input"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        disabled={saving}
        onChange={(e) => set_value(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}
