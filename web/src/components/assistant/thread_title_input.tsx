import { useRef, useState } from 'react';
import { CONVERSATION_TITLE_MAX_CHARS } from '../../lib/agent.types';

type Props = {
  initial: string;
  className: string;
  /** Resolves false when the save failed, so the input stays open with the title intact. */
  onCommit: (title: string) => Promise<boolean>;
  onCancel: () => void;
};

/** Inline rename: Enter or leaving the field saves, Escape backs out. */
export function ThreadTitleInput({ initial, className, onCommit, onCancel }: Props) {
  const [value, set_value] = useState(initial);
  const [saving, set_saving] = useState(false);
  // Enter commits and disabling the input then blurs it; without this the blur commits again.
  const committing_ref = useRef(false);

  async function commit() {
    if (committing_ref.current) return;
    const title = value.trim();
    if (!title || title === initial) {
      onCancel();
      return;
    }
    committing_ref.current = true;
    set_saving(true);
    const ok = await onCommit(title);
    if (!ok) {
      committing_ref.current = false;
      set_saving(false);
    }
  }

  return (
    <input
      className={className}
      value={value}
      placeholder="Thread title"
      aria-label="Thread title"
      maxLength={CONVERSATION_TITLE_MAX_CHARS}
      enterKeyHint="done"
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
  );
}
