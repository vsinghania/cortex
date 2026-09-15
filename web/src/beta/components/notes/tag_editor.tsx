import { useState } from 'react';
import { Icon } from '../../../components/icon';

type Props = {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
};

export function TagEditor({ tags, onChange, disabled = false }: Props) {
  const [adding, set_adding] = useState(false);
  const [value, set_value] = useState('');

  function commit() {
    const tag = value.trim().replace(/^#/, '');
    const exists = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
    if (tag && !exists) onChange([...tags, tag]);
    set_value('');
    set_adding(false);
  }

  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <span key={tag} className="chip chip-removable">
          #{tag}
          <button
            type="button"
            className="chip-remove"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            aria-label={`Remove tag ${tag}`}
            disabled={disabled}
          >
            <Icon name="close" size={10} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="chip-input"
          value={value}
          autoFocus
          placeholder="tag…"
          aria-label="New tag"
          onChange={(e) => set_value(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              set_value('');
              set_adding(false);
            }
          }}
        />
      ) : (
        <button type="button" className="chip chip-add" onClick={() => set_adding(true)} disabled={disabled}>
          + tag
        </button>
      )}
    </div>
  );
}
