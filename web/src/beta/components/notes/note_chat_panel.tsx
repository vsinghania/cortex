import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient } from '../../../lib/api_client';
import type { ContextRef, Conversation } from '../../../lib/agent.types';
import type { Note } from '../../../lib/note.types';
import { DateFormat } from '../../../lib/date_format';
import { Icon } from '../../../components/icon';
import { ChatView } from '../assistant/chat_view';
import { PopoverMenu } from '../popover_menu';
import { BetaRoutes } from '../../lib/beta_routes';
import { useChatThread } from '../../lib/use_chat_thread';

const NOTE_THREAD_LIMIT = 10;

const SUGGESTIONS = [
  'Summarise this note',
  'What are the open questions here?',
  'What else have I written about this?',
];

type Props = {
  note: Note;
  /** Saves any pending edits so the assistant reads what is on screen. */
  flush: () => Promise<void>;
};

/** A chat anchored to the open note: the server attaches the note to every turn of its threads. */
export function NoteChatPanel({ note, flush }: Props) {
  const thread = useChatThread();
  const [threads, set_threads] = useState<Conversation[]>([]);
  const context_ref = useMemo<ContextRef>(() => ({ corpus: 'notes', document_id: note.id }), [note.id]);

  const loadThreads = useCallback(async (): Promise<Conversation[]> => {
    try {
      const list = await ApiClient.listConversations({ context_ref, limit: NOTE_THREAD_LIMIT });
      set_threads(list);
      return list;
    } catch {
      // History is a convenience; a fresh chat still works without it.
      return [];
    }
  }, [context_ref]);

  // Each note reopens on its most recent thread.
  useEffect(() => {
    let cancelled = false;
    thread.reset();
    set_threads([]);
    async function openLatest() {
      const list = await loadThreads();
      if (!cancelled && list[0]) await thread.loadThread(list[0].conversation_id);
    }
    void openLatest();
    return () => {
      cancelled = true;
    };
    // thread.reset and thread.loadThread are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadThreads]);

  async function send(text: string) {
    const result = await thread.send(text, { context_ref, beforeSend: flush });
    // Titles are generated server-side on the first turn, and every turn reorders the list.
    if (result) void loadThreads();
  }

  function selectThread(conversation_id: string) {
    if (conversation_id !== thread.conversation_id) void thread.loadThread(conversation_id);
  }

  const current = threads.find((c) => c.conversation_id === thread.conversation_id);
  const note_title = note.title.trim() || 'Untitled note';

  return (
    <section className="note-chat" aria-label="Chat about this note">
      <div className="note-chat-header">
        <span className="note-chat-title" title={current?.title}>
          {thread.conversation_id ? current?.title ?? 'Untitled' : 'New chat'}
        </span>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          onClick={thread.reset}
          disabled={!thread.conversation_id && thread.turns.length === 0}
          aria-label="New chat"
          title="New chat"
        >
          <Icon name="plus" size={14} />
        </button>
        <PopoverMenu label="Chats about this note" trigger={<Icon name="more" size={14} />} trigger_class="icon-btn icon-btn-sm" align="end">
          {(close) => (
            <>
              <div className="menu-heading">Chats about this note</div>
              {threads.length === 0 ? (
                <p className="menu-empty">No saved chats yet.</p>
              ) : (
                threads.map((c) => (
                  <button
                    key={c.conversation_id}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      selectThread(c.conversation_id);
                      close();
                    }}
                  >
                    <span className="menu-item-label">{c.title ?? 'Untitled'}</span>
                    <time className="menu-item-meta" dateTime={c.updated_at}>{DateFormat.relative(c.updated_at)}</time>
                  </button>
                ))
              )}
              {thread.conversation_id && (
                <Link to={BetaRoutes.chat({ conversation_id: thread.conversation_id })} role="menuitem" className="menu-item" onClick={close}>
                  <Icon name="chat" size={13} />
                  <span className="menu-item-label">Open in Assistant</span>
                </Link>
              )}
            </>
          )}
        </PopoverMenu>
      </div>

      <ChatView
        variant="panel"
        turns={thread.turns}
        pending={thread.pending}
        thread_loading={thread.thread_loading}
        error={thread.error}
        onSend={(text) => void send(text)}
        onSaveAsNote={thread.saveTurnAsNote}
        suggestions={SUGGESTIONS}
        placeholder="Ask about this note…"
        welcome={
          <>
            <h1>Ask about “{note_title}”</h1>
            <p>I answer from this note first, and look across your other notes when it helps.</p>
          </>
        }
      />
    </section>
  );
}
