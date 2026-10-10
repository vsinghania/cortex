import { Icon } from '../icon';
import { PopoverMenu } from '../popover_menu';
import { NoteTagPicker } from './note_tag_picker';

type Props = {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
};

export function TagEditor({ tags, onChange, disabled = false }: Props) {
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
      {disabled ? <button type="button" className="chip chip-add" disabled>+ tag</button> : (
        <PopoverMenu label="Add tag" trigger="+ tag" trigger_class="chip chip-add">
          {(close) => (
            <div className="picker">
              <NoteTagPicker
                selected_tags={tags}
                input_label="Find or create a tag"
                onAddTag={(tag) => {
                  close();
                  onChange([...tags, tag]);
                }}
              />
            </div>
          )}
        </PopoverMenu>
      )}
    </div>
  );
}
