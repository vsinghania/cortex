import { Icon } from '../icon';
import type { IconName } from '../icon';
import type { FolderTreeNode, NoteFilters } from '../../lib/note_workspace.types';
import { FolderTree } from '../../lib/folder_tree';
import { NoteFilterParams } from '../../lib/note_filter_params';
import { BottomSheet } from '../mobile/bottom_sheet';

const FOLDER_INDENT_PX = 16;

type Props = {
  open: boolean;
  filters: NoteFilters;
  folder_tree: FolderTreeNode[];
  onSelect: (patch: Partial<NoteFilters>) => void;
  onClose: () => void;
};

type View = { key: string; label: string; icon: IconName; active: boolean; patch: Partial<NoteFilters> };

/** The phone's stand-in for picking a folder in the rail: the list title opens this. */
export function MobileFolderSheet({ open, filters, folder_tree, onSelect, onClose }: Props) {
  const no_tag = !filters.tag;
  const views: View[] = [
    {
      key: 'all',
      label: 'All notes',
      icon: 'layers',
      active: no_tag && !filters.folder && !filters.archived,
      patch: { folder: null, archived: false, tag: null },
    },
    {
      key: 'unfiled',
      label: 'Unfiled',
      icon: 'inbox',
      active: no_tag && filters.folder === NoteFilterParams.UNFILED,
      patch: { folder: NoteFilterParams.UNFILED, archived: false, tag: null },
    },
    {
      key: 'archive',
      label: 'Archive',
      icon: 'archive',
      active: no_tag && filters.archived,
      patch: { folder: null, archived: true, tag: null },
    },
  ];

  function choose(patch: Partial<NoteFilters>) {
    onClose();
    onSelect(patch);
  }

  return (
    <BottomSheet open={open} title="Show notes from" onClose={onClose}>
      <div className="m-actions">
        {views.map((view) => (
          <button
            key={view.key}
            type="button"
            className={`m-action${view.active ? ' m-action-active' : ''}`}
            onClick={() => choose(view.patch)}
          >
            <Icon name={view.icon} size={17} />
            {view.label}
            {view.active && <Icon name="check" size={15} className="m-action-check" />}
          </button>
        ))}

        {folder_tree.length > 0 && <div className="m-actions-heading">Folders</div>}
        {FolderTree.flatten(folder_tree).map((folder) => {
          const active = no_tag && !filters.archived && filters.folder === folder.id;
          return (
            <button
              key={folder.id}
              type="button"
              className={`m-action${active ? ' m-action-active' : ''}`}
              style={{ paddingLeft: 12 + folder.depth * FOLDER_INDENT_PX }}
              onClick={() => choose({ folder: folder.id, archived: false, tag: null })}
            >
              <Icon name="folder" size={17} />
              {folder.name}
              {active && <Icon name="check" size={15} className="m-action-check" />}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
