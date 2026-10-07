import { useMemo, useState } from 'react';
import type { Conversation } from '../../lib/agent.types';
import { DateFormat } from '../../lib/date_format';
import { Icon } from '../icon';
import { ThreadTitleInput } from './thread_title_input';

type Props = {
  conversations: Conversation[];
  loading: boolean;
  selected_id: string | null;
  busy_id: string | null;
  onSelect: (conversation_id: string) => void;
  onTogglePin: (conversation: Conversation) => void;
  /** Resolves false when the rename failed, so the row stays in edit mode. */
  onRename: (conversation: Conversation, title: string) => Promise<boolean>;
  onDelete: (conversation: Conversation) => void;
};

export function ThreadList({ conversations, loading, selected_id, busy_id, onSelect, onTogglePin, onRename, onDelete }: Props) {
  const [query, set_query] = useState('');
  const [renaming_id, set_renaming_id] = useState<string | null>(null);

  async function commitRename(c: Conversation, title: string): Promise<boolean> {
    const ok = await onRename(c, title);
    if (ok) set_renaming_id(null);
    return ok;
  }

  const { pinned, others } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = conversations
      .filter((c) => !q || (c.title ?? 'Untitled').toLowerCase().includes(q))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { pinned: matches.filter((c) => c.is_pinned), others: matches.filter((c) => !c.is_pinned) };
  }, [conversations, query]);

  const count = pinned.length + others.length;

  function renderRow(c: Conversation) {
    const active = c.conversation_id === selected_id;
    const title = c.title ?? 'Untitled';
    if (c.conversation_id === renaming_id) {
      return (
        <div key={c.conversation_id} className={`thread-row thread-row-renaming${active ? ' list-row-active' : ''}`}>
          <ThreadTitleInput
            initial={c.title ?? ''}
            className="tree-input thread-title-input"
            onCommit={(next) => commitRename(c, next)}
            onCancel={() => set_renaming_id(null)}
          />
        </div>
      );
    }
    return (
      <div key={c.conversation_id} className={`thread-row${active ? ' list-row-active' : ''}`}>
        <button type="button" className="thread-select" aria-current={active ? 'true' : undefined} onClick={() => onSelect(c.conversation_id)}>
          <span className="list-row-top">
            {c.is_pinned && <Icon name="pin" size={11} className="list-row-pin" />}
            {c.context_ref && (
              <span className="thread-note-mark" title="About a note">
                <Icon name="notes" size={11} />
                <span className="sr-only">About a note:</span>
              </span>
            )}
            <span className="list-row-title">{title}</span>
            <time className="list-row-time" dateTime={c.updated_at} title={DateFormat.full(c.updated_at)}>
              {DateFormat.relative(c.updated_at)}
            </time>
          </span>
        </button>
        <span className="thread-actions">
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label={`Rename ${title}`}
            title="Rename"
            disabled={busy_id === c.conversation_id}
            onClick={() => set_renaming_id(c.conversation_id)}
          >
            <Icon name="edit" size={13} />
          </button>
          <button
            type="button"
            className={`icon-btn icon-btn-sm${c.is_pinned ? ' icon-btn-accent' : ''}`}
            aria-label={c.is_pinned ? `Unpin ${title}` : `Pin ${title}`}
            aria-pressed={!!c.is_pinned}
            title={c.is_pinned ? 'Unpin' : 'Pin'}
            disabled={busy_id === c.conversation_id}
            onClick={() => onTogglePin(c)}
          >
            <Icon name="pin" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm icon-btn-danger"
            aria-label={`Delete ${title}`}
            title="Delete"
            disabled={busy_id === c.conversation_id}
            onClick={() => onDelete(c)}
          >
            <Icon name="trash" size={13} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <section className="list-pane" aria-label="Threads">
      <div className="list-search">
        <Icon name="search" size={14} className="list-search-icon" />
        <input
          type="search"
          value={query}
          onChange={(e) => set_query(e.target.value)}
          placeholder="Search threads…"
          aria-label="Search threads"
          className="input input-search"
        />
      </div>
      <div className="list-header">
        <div className="list-header-title">
          <span className="list-label">Threads</span>
          {!loading && <span className="mono-count">{count}</span>}
        </div>
        <span className="list-header-hint">Recent</span>
      </div>
      <div className="list-scroll">
        {loading ? (
          <div className="list-empty"><span className="dots" aria-label="Loading threads"><i /><i /><i /></span></div>
        ) : count === 0 ? (
          <p className="list-empty">{query ? 'No threads match.' : 'No threads yet.'}</p>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <div className="list-group-label">Pinned</div>
                {pinned.map(renderRow)}
                {others.length > 0 && <div className="list-group-label">Recent</div>}
              </>
            )}
            {others.map(renderRow)}
          </>
        )}
      </div>
    </section>
  );
}
