import { useState } from 'react';
import type { Note, NotePatchBody } from '../../lib/note.types';
import type { NoteFolderNode } from '../../lib/note_folder.types';
import { Icon } from '../icon';
import type { FolderTreeNode } from '../../lib/note_workspace.types';
import { FolderTree } from '../../lib/folder_tree';
import { MobileBar, MobileBarButton, MobileBarTitle } from '../mobile/mobile_bar';
import { BottomSheet } from '../mobile/bottom_sheet';
import { NoteModeSwitch } from './note_mode_switch';
import type { EditorMode } from './note_mode_switch';
import { FolderMoveList } from './folder_move_list';
import type { SuggestControl } from './note_toolbar';

type Props = {
  note: Note | null;
  title: string;
  folders_by_id: Map<string, NoteFolderNode>;
  folder_tree: FolderTreeNode[];
  mode: EditorMode;
  refreshing: boolean;
  deleted: boolean;
  onRefresh: () => void;
  show_mode: boolean;
  suggest: SuggestControl | null;
  onBack: () => void;
  onOpenChat: () => void;
  onOpenDetails: () => void;
  onModeChange: (mode: EditorMode) => void;
  onOrganize: (patch: NotePatchBody) => void;
  onDelete: () => void;
};

/**
 * The note detail bar. The desktop toolbar's eight icon buttons don't fit at thumb size, so
 * the low-frequency ones move into an action sheet — a sheet rather than a popover because
 * "Move to folder" needs room for the folder tree.
 */
export function MobileNoteBar(props: Props) {
  const { note, title } = props;
  const [actions_open, set_actions_open] = useState(false);
  const folder_label = note ? FolderTree.pathLabel(note.folder_id ? props.folders_by_id.get(note.folder_id) : undefined) : 'Draft';

  function organize(patch: NotePatchBody) {
    set_actions_open(false);
    props.onOrganize(patch);
  }

  return (
    <>
      <MobileBar>
        <MobileBarButton label="Back to notes" icon="back" onClick={props.onBack} accent />
        <MobileBarTitle title={title.trim() || note?.title || 'Untitled note'} subtitle={folder_label} />
        {props.show_mode && <NoteModeSwitch mode={props.mode} onChange={props.onModeChange} />}
        {note && <MobileBarButton label="Chat about this note" icon="sparkle" onClick={props.onOpenChat} />}
        {note && <MobileBarButton label="More actions" icon="more" onClick={() => set_actions_open(true)} />}
      </MobileBar>

      {note && (
        <BottomSheet open={actions_open} title="Note actions" onClose={() => set_actions_open(false)}>
          <div className="m-actions">
            <button
              type="button"
              className="m-action"
              disabled={props.refreshing || props.deleted}
              aria-busy={props.refreshing}
              onClick={() => {
                set_actions_open(false);
                props.onRefresh();
              }}
            >
              {props.refreshing ? <span className="spin-ring spin-ring-sm" aria-hidden="true" /> : <Icon name="refresh" size={17} />}
              {props.refreshing ? 'Refreshing…' : 'Refresh current note'}
            </button>
            <button
              type="button"
              className="m-action"
              onClick={() => {
                set_actions_open(false);
                props.onOpenDetails();
              }}
            >
              <Icon name="info" size={17} />
              Note details
            </button>
            <button type="button" className="m-action" disabled={props.deleted} onClick={() => organize({ is_pinned: !note.is_pinned })}>
              <Icon name="pin" size={17} />
              {note.is_pinned ? 'Unpin note' : 'Pin note'}
            </button>
            {props.suggest && (
              <button
                type="button"
                className="m-action"
                disabled={props.suggest.disabled || props.suggest.busy}
                onClick={() => {
                  set_actions_open(false);
                  props.suggest?.onRequest();
                }}
              >
                <Icon name="wand" size={17} />
                {props.suggest.busy ? 'Suggesting…' : 'Suggest title, folder and tags'}
              </button>
            )}
            <button type="button" className="m-action" disabled={props.deleted} onClick={() => organize({ is_archived: !note.is_archived })}>
              <Icon name="archive" size={17} />
              {note.is_archived ? 'Unarchive note' : 'Archive note'}
            </button>
            <button
              type="button"
              className="m-action m-action-danger"
              disabled={props.deleted}
              onClick={() => {
                set_actions_open(false);
                props.onDelete();
              }}
            >
              <Icon name="trash" size={17} />
              Delete note
            </button>

            {!props.deleted && (
              <>
                <div className="m-actions-heading">Move to</div>
                <FolderMoveList
                  tree={props.folder_tree}
                  current_folder_id={note.folder_id}
                  onMove={(folder_id) => organize({ folder_id })}
                  close={() => set_actions_open(false)}
                />
              </>
            )}
          </div>
        </BottomSheet>
      )}
    </>
  );
}
