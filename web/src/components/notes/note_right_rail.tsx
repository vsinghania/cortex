import { useId, useMemo, useRef } from 'react';
import type { Note } from '../../lib/note.types';
import type { NoteFolderNode } from '../../lib/note_folder.types';
import { DateFormat } from '../../lib/date_format';
import { NoteOutline } from '../../lib/note_outline';
import { FolderTree } from '../../lib/folder_tree';
import { Icon } from '../icon';
import { NoteChatPanel } from './note_chat_panel';

export type NoteRailTab = 'details' | 'chat';

type Props = {
  note: Note;
  folders_by_id: Map<string, NoteFolderNode>;
  related: Note[];
  tab: NoteRailTab;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onTabChange: (tab: NoteRailTab) => void;
  onOutline: (line: number) => void;
  onOpenNote: (note_id: string) => void;
  flush: () => Promise<void>;
};

export function NoteRightRail(props: Props) {
  const { note, tab, onTabChange, collapsed = false, onToggleCollapse } = props;
  const content_id = useId();
  const expand_button_ref = useRef<HTMLButtonElement>(null);
  const collapse_button_ref = useRef<HTMLButtonElement>(null);

  function togglePanelCollapse() {
    onToggleCollapse?.();
    window.requestAnimationFrame(() => {
      (collapsed ? collapse_button_ref : expand_button_ref).current?.focus();
    });
  }

  function expandPanelTab(value: NoteRailTab) {
    onTabChange(value);
    window.requestAnimationFrame(() => collapse_button_ref.current?.focus());
  }

  return (
    <aside className={`side-rail note-rail${tab === 'chat' ? ' side-rail-wide' : ''}${collapsed ? ' note-rail-collapsed' : ''}`} aria-label="Note details">
      {collapsed && (
        <div className="note-rail-collapsed-actions">
          <button ref={expand_button_ref} type="button" className="icon-btn" onClick={togglePanelCollapse} aria-label="Expand note panel" title="Expand note panel" aria-expanded={false} aria-controls={content_id}>
            <Icon name="chevrons_left" size={15} />
          </button>
          {(['details', 'chat'] as const).map((value) => (
            <button key={value} type="button" className="icon-btn" onClick={() => expandPanelTab(value)} aria-label={value === 'details' ? 'Open note details' : 'Chat about this note'} title={value === 'details' ? 'Open note details' : 'Chat about this note'}>
              <Icon name={value === 'details' ? 'layers' : 'sparkle'} size={15} />
            </button>
          ))}
        </div>
      )}
      <div id={content_id} className="note-rail-content" hidden={collapsed}>
        <div className="segmented note-rail-tabs" role="tablist" aria-label="Note panel">
          {(['details', 'chat'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`segmented-item${tab === value ? ' segmented-item-active' : ''}`}
              onClick={() => onTabChange(value)}
            >
              <Icon name={value === 'details' ? 'layers' : 'sparkle'} size={12} />
              {value === 'details' ? 'Details' : 'Chat'}
            </button>
          ))}
          {tab === 'chat' && (
            <button type="button" className="icon-btn icon-btn-sm note-rail-close" onClick={() => onTabChange('details')} aria-label="Close chat" title="Close chat">
              <Icon name="close" size={13} />
            </button>
          )}
          {onToggleCollapse && (
            <button ref={collapse_button_ref} type="button" className="icon-btn icon-btn-sm" onClick={togglePanelCollapse} aria-label="Collapse note panel" title="Collapse note panel" aria-expanded={true} aria-controls={content_id}>
              <Icon name="chevrons_right" size={15} />
            </button>
          )}
        </div>
        {tab === 'chat' ? (
          <NoteChatPanel key={note.id} note={note} flush={props.flush} />
        ) : (
          <NoteDetails {...props} />
        )}
      </div>
    </aside>
  );
}

function NoteDetails({ note, folders_by_id, related, onOutline, onOpenNote }: Props) {
  const outline = useMemo(() => NoteOutline.headings(note.body), [note.body]);

  return (
    <div className="note-rail-details">
      <div className="side-heading">Outline</div>
      <nav className="outline" aria-label="Outline">
        {outline.length === 0 ? (
          <p className="side-empty">Add a heading to build the outline.</p>
        ) : (
          outline.map((heading) => (
            <button
              key={heading.line}
              type="button"
              className={`outline-item outline-level-${heading.level}`}
              onClick={() => onOutline(heading.line)}
            >
              {heading.text}
            </button>
          ))
        )}
      </nav>

      <div className="side-heading">Details</div>
      <dl className="details">
        <dt>Created</dt>
        <dd className="mono-meta">{DateFormat.full(note.created_at)}</dd>
        <dt>Updated</dt>
        <dd className="mono-meta">{DateFormat.relative(note.edited_at)}</dd>
        <dt>Words</dt>
        <dd className="mono-meta">{NoteOutline.wordCount(note.body)}</dd>
        <dt>Folder</dt>
        <dd>{FolderTree.pathLabel(note.folder_id ? folders_by_id.get(note.folder_id) : undefined)}</dd>
      </dl>

      <div className="side-heading">Related</div>
      <div className="related">
        {related.length === 0 ? (
          <p className="side-empty">{note.tags.length === 0 ? 'Tag this note to see related ones.' : 'No related notes yet.'}</p>
        ) : (
          related.map((r) => (
            <button key={r.id} type="button" className="related-card" onClick={() => onOpenNote(r.id)}>
              <span className="related-title">{r.title || 'Untitled'}</span>
              <span className="related-time">{DateFormat.relative(r.edited_at)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
