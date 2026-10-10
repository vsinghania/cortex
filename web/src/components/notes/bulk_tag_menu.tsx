import type { Note } from '../../lib/note.types';
import { Icon } from '../icon';
import { PopoverMenu } from '../popover_menu';
import { NoteBulk } from '../../lib/note_bulk';
import { NoteTagOptions } from '../../lib/note_tag_options';
import { NoteTagPicker } from './note_tag_picker';

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
  const present = NoteBulk.tagsIn(notes);

  return (
    <div className="picker">
      <div className="menu-heading">Add tag</div>
      <NoteTagPicker
        selected_tags={NoteTagOptions.findCommonTags(notes.map(({ tags }) => tags))}
        input_label="Tag to add to selected notes"
        onAddTag={(tag) => {
          close();
          onAddTag(tag);
        }}
      />
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
