import { useMemo } from 'react';
import type { Note } from '../../../lib/note.types';
import type { NoteFolderNode } from '../../../lib/note_folder.types';
import { DateFormat } from '../../../lib/date_format';
import { NoteOutline } from '../../lib/note_outline';
import { FolderTree } from '../../lib/folder_tree';
import { Icon } from '../../../components/icon';
import { NoteChatPanel } from './note_chat_panel';

export type NoteRailTab = 'details' | 'chat';

type Props = {
  note: Note;
  folders_by_id: Map<string, NoteFolderNode>;
  related: Note[];
  tab: NoteRailTab;
  onTabChange: (tab: NoteRailTab) => void;
  onOutline: (line: number) => void;
  onOpenNote: (note_id: string) => void;
  flush: () => Promise<void>;
};

export function NoteRightRail(props: Props) {
  const { note, tab, onTabChange } = props;

  return (
    <aside className={`side-rail note-rail${tab === 'chat' ? ' side-rail-wide' : ''}`} aria-label="Note details">
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
      </div>
      {tab === 'chat' ? (
        <NoteChatPanel key={note.id} note={note} flush={props.flush} />
      ) : (
        <NoteDetails {...props} />
      )}
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
        <dd className="mono-meta">{DateFormat.relative(note.updated_at)}</dd>
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
              <span className="related-time">{DateFormat.relative(r.updated_at)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
