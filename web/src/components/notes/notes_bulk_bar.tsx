import type { Note, NoteBulkAction } from '../../lib/note.types';
import { Icon } from '../icon';
import type { FolderTreeNode } from '../../lib/note_workspace.types';
import { PopoverMenu } from '../popover_menu';
import { FolderMoveList } from './folder_move_list';
import { BulkTagMenu } from './bulk_tag_menu';

type Props = {
  notes: Note[];
  folder_tree: FolderTreeNode[];
  busy: boolean;
  onAction: (action: NoteBulkAction) => void;
  onDelete: () => void;
};

/** Actions for the selected notes. A toggle flips only when every selected note is already in that state. */
export function NotesBulkBar({ notes, folder_tree, busy, onAction, onDelete }: Props) {
  const disabled = busy || notes.length === 0;
  const all_pinned = notes.length > 0 && notes.every((n) => n.is_pinned);
  const all_archived = notes.length > 0 && notes.every((n) => n.is_archived);
  const folders_mixed = notes.some((n) => n.folder_id !== notes[0]?.folder_id);

  return (
    <div className="bulk-bar" role="toolbar" aria-label="Selected notes">
      <button
        type="button"
        className="icon-btn bulk-btn"
        disabled={disabled}
        onClick={() => onAction({ action: all_pinned ? 'unpin' : 'pin' })}
        aria-label={all_pinned ? 'Unpin selected' : 'Pin selected'}
        title={all_pinned ? 'Unpin' : 'Pin'}
      >
        <Icon name="pin" size={15} />
      </button>

      {disabled ? (
        <button type="button" className="icon-btn bulk-btn" disabled aria-label="Move selected" title="Move to folder">
          <Icon name="folder_move" size={15} />
        </button>
      ) : (
        <PopoverMenu label="Move selected" trigger={<Icon name="folder_move" size={15} />} trigger_class="icon-btn bulk-btn" placement="above">
          {(close) => (
            <div className="picker">
              <div className="menu-heading">Move to</div>
              <FolderMoveList
                tree={folder_tree}
                current_folder_id={notes[0]?.folder_id}
                mixed={folders_mixed}
                onMove={(folder_id) => onAction({ action: 'move', folder_id })}
                close={close}
              />
            </div>
          )}
        </PopoverMenu>
      )}

      <BulkTagMenu
        notes={notes}
        disabled={disabled}
        onAddTag={(tag) => onAction({ action: 'add_tags', tags: [tag] })}
        onRemoveTag={(tag) => onAction({ action: 'remove_tags', tags: [tag] })}
      />

      <button
        type="button"
        className="icon-btn bulk-btn"
        disabled={disabled}
        onClick={() => onAction({ action: all_archived ? 'unarchive' : 'archive' })}
        aria-label={all_archived ? 'Unarchive selected' : 'Archive selected'}
        title={all_archived ? 'Unarchive' : 'Archive'}
      >
        <Icon name="archive" size={15} />
      </button>

      <span className="bulk-bar-spacer" />

      <button type="button" className="icon-btn bulk-btn icon-btn-danger" disabled={disabled} onClick={onDelete} aria-label="Delete selected" title="Delete">
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}
