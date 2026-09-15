import type { Note, NotePatchBody } from '../../../lib/note.types';
import type { NoteFolderNode } from '../../../lib/note_folder.types';
import { Icon } from '../../../components/icon';
import type { FolderTreeNode } from '../../lib/note_workspace.types';
import { FolderTree } from '../../lib/folder_tree';
import { NoteModeSwitch } from './note_mode_switch';
import type { EditorMode } from './note_mode_switch';
import { FolderPicker } from './folder_picker';

type Props = {
  note: Note | null;
  title: string;
  folders_by_id: Map<string, NoteFolderNode>;
  folder_tree: FolderTreeNode[];
  mode: EditorMode;
  show_mode: boolean;
  list_collapsed: boolean;
  onToggleList: () => void;
  onModeChange: (mode: EditorMode) => void;
  onOrganize: (patch: NotePatchBody) => void;
  onDelete: () => void;
};

export function NoteToolbar(props: Props) {
  const { note, title, mode, list_collapsed } = props;
  const folder_label = note ? FolderTree.pathLabel(note.folder_id ? props.folders_by_id.get(note.folder_id) : undefined) : 'Draft';

  return (
    <div className="toolbar">
      <div className="toolbar-crumbs">
        <button
          type="button"
          className={`icon-btn${list_collapsed ? ' icon-btn-accent' : ''}`}
          onClick={props.onToggleList}
          aria-label={list_collapsed ? 'Show note list' : 'Hide note list'}
          title={list_collapsed ? 'Show note list' : 'Hide note list'}
        >
          <Icon name="panel" size={15} />
        </button>
        <span className="crumb-muted">{folder_label}</span>
        <Icon name="chevron_right" size={12} className="crumb-sep" />
        <span className="crumb-current">{title.trim() || note?.title || 'Untitled note'}</span>
        {note?.is_archived && <span className="badge badge-sm">Archived</span>}
      </div>

      <div className="toolbar-actions">
        {props.show_mode && <NoteModeSwitch mode={mode} onChange={props.onModeChange} />}
        {note && (
          <>
            <span className="toolbar-divider" aria-hidden="true" />
            <button
              type="button"
              className={`icon-btn toolbar-btn${note.is_pinned ? ' icon-btn-accent' : ''}`}
              onClick={() => props.onOrganize({ is_pinned: !note.is_pinned })}
              aria-label={note.is_pinned ? 'Unpin note' : 'Pin note'}
              aria-pressed={!!note.is_pinned}
              title={note.is_pinned ? 'Unpin' : 'Pin'}
            >
              <Icon name="pin" size={15} />
            </button>
            <FolderPicker tree={props.folder_tree} current_folder_id={note.folder_id} onMove={(folder_id) => props.onOrganize({ folder_id })} />
            <button
              type="button"
              className="icon-btn toolbar-btn"
              onClick={() => props.onOrganize({ is_archived: !note.is_archived })}
              aria-label={note.is_archived ? 'Unarchive note' : 'Archive note'}
              title={note.is_archived ? 'Unarchive' : 'Archive'}
            >
              <Icon name="archive" size={15} />
            </button>
            <button type="button" className="icon-btn toolbar-btn icon-btn-danger" onClick={props.onDelete} aria-label="Delete note" title="Delete">
              <Icon name="trash" size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
