import type { CSSProperties } from 'react';
import { Icon } from '../../../components/icon';
import type { FolderTreeNode } from '../../lib/note_workspace.types';
import { FolderTree } from '../../lib/folder_tree';
import { PopoverMenu } from '../popover_menu';

type Props = {
  tree: FolderTreeNode[];
  current_folder_id: string | undefined;
  onMove: (folder_id: string | null) => void;
};

export function FolderPicker({ tree, current_folder_id, onMove }: Props) {
  const flat = FolderTree.flatten(tree);

  return (
    <PopoverMenu label="Move to folder" trigger={<Icon name="folder_move" size={15} />} trigger_class="icon-btn toolbar-btn" align="end">
      {(close) => (
        <div className="picker">
          <div className="menu-heading">Move to</div>
          <div className="picker-scroll">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!current_folder_id}
              className="menu-item"
              onClick={() => {
                close();
                if (current_folder_id) onMove(null);
              }}
            >
              <Icon name="inbox" size={14} />
              <span className="menu-item-label">Unfiled</span>
              {!current_folder_id && <Icon name="check" size={13} className="menu-item-check" />}
            </button>
            {flat.map((folder) => {
              const is_current = folder.id === current_folder_id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={is_current}
                  className="menu-item"
                  style={{ '--depth': folder.depth } as CSSProperties}
                  onClick={() => {
                    close();
                    if (!is_current) onMove(folder.id);
                  }}
                >
                  <Icon name="folder" size={14} />
                  <span className="menu-item-label menu-item-indented">{folder.name}</span>
                  {is_current && <Icon name="check" size={13} className="menu-item-check" />}
                </button>
              );
            })}
            {flat.length === 0 && <p className="menu-note">No folders yet. Create one from the sidebar.</p>}
          </div>
        </div>
      )}
    </PopoverMenu>
  );
}
