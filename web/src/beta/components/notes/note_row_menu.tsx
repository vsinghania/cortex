import { useState } from 'react';
import type { Note, NotePatchBody } from '../../../lib/note.types';
import { Icon } from '../../../components/icon';
import type { FolderTreeNode } from '../../lib/note_workspace.types';
import { PopoverMenu } from '../popover_menu';
import { FolderMoveList } from './folder_move_list';

type Props = {
  note: Note;
  folder_tree: FolderTreeNode[];
  onOrganize: (note: Note, patch: NotePatchBody) => void;
  onDelete: (note: Note) => void;
};

export function NoteRowMenu({ note, folder_tree, onOrganize, onDelete }: Props) {
  const title = note.title || 'Untitled';
  return (
    <PopoverMenu label={`Actions for ${title}`} trigger={<Icon name="more" size={14} />} trigger_class="icon-btn icon-btn-sm" align="end">
      {(close) => <MenuContent note={note} folder_tree={folder_tree} onOrganize={onOrganize} onDelete={onDelete} close={close} />}
    </PopoverMenu>
  );
}

/** Mounted only while the menu is open, so it always reopens on the main actions rather than the folder list. */
function MenuContent({ note, folder_tree, onOrganize, onDelete, close }: Props & { close: () => void }) {
  const [view, set_view] = useState<'actions' | 'move'>('actions');

  function act(action: () => void) {
    close();
    action();
  }

  if (view === 'move') {
    return (
      <div className="picker">
        <button type="button" className="menu-item" onClick={() => set_view('actions')}>
          <Icon name="back" size={14} />
          <span className="menu-item-label">Move to</span>
        </button>
        <div className="menu-divider" />
        <FolderMoveList
          tree={folder_tree}
          current_folder_id={note.folder_id}
          onMove={(folder_id) => onOrganize(note, { folder_id })}
          close={close}
        />
      </div>
    );
  }

  return (
    <>
      <button type="button" role="menuitem" className="menu-item" onClick={() => act(() => onOrganize(note, { is_pinned: !note.is_pinned }))}>
        <Icon name="pin" size={14} />
        <span className="menu-item-label">{note.is_pinned ? 'Unpin' : 'Pin'}</span>
      </button>
      <button type="button" role="menuitem" aria-haspopup="menu" className="menu-item" onClick={() => set_view('move')}>
        <Icon name="folder_move" size={14} />
        <span className="menu-item-label">Move to folder</span>
        <Icon name="chevron_right" size={13} />
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => act(() => onOrganize(note, { is_archived: !note.is_archived }))}>
        <Icon name="archive" size={14} />
        <span className="menu-item-label">{note.is_archived ? 'Unarchive' : 'Archive'}</span>
      </button>
      <div className="menu-divider" />
      <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={() => act(() => onDelete(note))}>
        <Icon name="trash" size={14} />
        <span className="menu-item-label">Delete…</span>
      </button>
    </>
  );
}
