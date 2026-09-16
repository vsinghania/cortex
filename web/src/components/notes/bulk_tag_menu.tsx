import { useState } from 'react';
import type { Note } from '../../lib/note.types';
import { Icon } from '../icon';
import { PopoverMenu } from '../popover_menu';
import { NoteBulk } from '../../lib/note_bulk';

type Props = {
  notes: Note[];
  disabled: boolean;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
};

export function BulkTagMenu({ notes, disabled, onAddTag, onRemoveTag }: Props) {
  if (disabled) {
    return (
      <button type="button" className="icon-btn bulk-btn" disabled aria-label="Tags" title="Tags">
        <Icon name="hash" size={15} />
      </button>
    );
  }
  return (
    <PopoverMenu label="Tags" trigger={<Icon name="hash" size={15} />} trigger_class="icon-btn bulk-btn" placement="above">
      {(close) => <TagMenuContent notes={notes} close={close} onAddTag={onAddTag} onRemoveTag={onRemoveTag} />}
    </PopoverMenu>
  );
}

function TagMenuContent({ notes, close, onAddTag, onRemoveTag }: Omit<Props, 'disabled'> & { close: () => void }) {
  const [value, set_value] = useState('');
  const present = NoteBulk.tagsIn(notes);

  function add() {
    const tag = value.trim().replace(/^#/, '');
    if (!tag) return;
    close();
    onAddTag(tag);
  }

  return (
    <div className="picker">
      <div className="menu-heading">Add tag</div>
      <form
        className="bulk-tag-form"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="input bulk-tag-input"
          value={value}
          autoFocus
          placeholder="tag…"
          aria-label="Tag to add to selected notes"
          onChange={(e) => set_value(e.target.value)}
        />
        <button type="submit" className="icon-btn" disabled={!value.trim()} aria-label="Add tag" title="Add tag">
          <Icon name="plus" size={14} />
        </button>
      </form>
      {present.length > 0 && (
        <>
          <div className="menu-divider" />
          <div className="menu-heading">Remove tag</div>
          <div className="picker-scroll">
            {present.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  close();
                  onRemoveTag(tag);
                }}
              >
                <Icon name="close" size={13} />
                <span className="menu-item-label">#{tag}</span>
                <span className="menu-item-meta">{count}/{notes.length}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
