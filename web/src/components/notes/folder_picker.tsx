import { Icon } from '../icon';
import type { FolderTreeNode } from '../../lib/note_workspace.types';
import { PopoverMenu } from '../popover_menu';
import { FolderMoveList } from './folder_move_list';

type Props = {
  tree: FolderTreeNode[];
  current_folder_id: string | undefined;
  onMove: (folder_id: string | null) => void;
};

export function FolderPicker({ tree, current_folder_id, onMove }: Props) {
  return (
    <PopoverMenu label="Move to folder" trigger={<Icon name="folder_move" size={15} />} trigger_class="icon-btn toolbar-btn" align="end">
      {(close) => (
        <div className="picker">
          <div className="menu-heading">Move to</div>
          <FolderMoveList tree={tree} current_folder_id={current_folder_id} onMove={onMove} close={close} />
        </div>
      )}
    </PopoverMenu>
  );
}
