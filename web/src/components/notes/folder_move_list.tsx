import type { CSSProperties } from 'react';
import { Icon } from '../icon';
import type { FolderTreeNode } from '../../lib/note_workspace.types';
import { FolderTree } from '../../lib/folder_tree';

type Props = {
  tree: FolderTreeNode[];
  current_folder_id: string | undefined;
  /** The notes being moved sit in different folders: nothing is checked and every choice applies. */
  mixed?: boolean;
  onMove: (folder_id: string | null) => void;
  /** Dismisses the surrounding menu; called before onMove, which is skipped for the current folder. */
  close: () => void;
};

/** The "Move to" folder choices, shared by the editor toolbar and the notes list row menu. */
export function FolderMoveList({ tree, current_folder_id, mixed = false, onMove, close }: Props) {
  const flat = FolderTree.flatten(tree);
  const unfiled_is_current = !mixed && !current_folder_id;

  return (
    <div className="picker-scroll">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={unfiled_is_current}
        className="menu-item"
        onClick={() => {
          close();
          if (!unfiled_is_current) onMove(null);
        }}
      >
        <Icon name="inbox" size={14} />
        <span className="menu-item-label">Unfiled</span>
        {unfiled_is_current && <Icon name="check" size={13} className="menu-item-check" />}
      </button>
      {flat.map((folder) => {
        const is_current = !mixed && folder.id === current_folder_id;
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
  );
}
