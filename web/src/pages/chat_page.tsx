import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import { NOTES_RECALL_AGENT_ID } from '../lib/agent.types';
import type { Citation, Conversation, ConversationMessage } from '../lib/agent.types';
import { DateFormat } from '../lib/date_format';
import { useAutosize } from '../lib/use_autosize';
import { ChatMessage, ChatTypingIndicator } from '../components/chat_message';
import { EmptyState } from '../components/empty_state';
import { Icon } from '../components/icon';
import { Spinner } from '../components/spinner';

type Turn = { role: 'user' | 'assistant'; text: string; citations?: Citation[] };

const COMPOSER_MAX_HEIGHT_PX = 200;

function contentToText(parts: ConversationMessage['content']): string {
  return parts
    .map((p) => (p.type === 'text' ? p.text : p.type === 'json' ? JSON.stringify(p.data) : ''))
    .join('');
}

function toDisplayTurns(messages: ConversationMessage[]): Turn[] {
  return messages
    .filter((m): m is ConversationMessage & { role: 'user' | 'assistant' } =>
      m.role === 'user' || m.role === 'assistant'
    )
    .map((m) => ({ role: m.role, text: contentToText(m.content), citations: m.citations }))
    .filter((t) => t.text.trim() !== '');
}

function chatPath(conversation_id: string): string {
  return `/chat/${encodeURIComponent(conversation_id)}`;
}

export function ChatPage() {
  const { conversation_id: route_conversation_id } = useParams<{ conversation_id: string }>();
  const navigate = useNavigate();
  const [conversations, set_conversations] = useState<Conversation[]>([]);
  const [conv_loading, set_conv_loading] = useState(true);
  const [messages, set_messages] = useState<Turn[]>([]);
  const [input, set_input] = useState('');
  const [conversation_id, set_conversation_id] = useState<string | null>(null);
  const [pending, set_pending] = useState(false);
  const [thread_loading, set_thread_loading] = useState(false);
  const [deleting_id, set_deleting_id] = useState<string | null>(null);
  const [error, set_error] = useState<string | null>(null);
  const thread_ref = useRef<HTMLDivElement>(null);
  const input_ref = useRef<HTMLTextAreaElement>(null);

  useAutosize(input_ref, input, COMPOSER_MAX_HEIGHT_PX);

  const loadConversations = useCallback(async () => {
    try {
      const result = await ApiClient.listConversations({ limit: 50 });
      set_conversations(result);
    } catch {
      // non-fatal: sidebar just stays empty
    } finally {
      set_conv_loading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    thread_ref.current?.scrollTo({ top: thread_ref.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  function resetThread() {
    set_conversation_id(null);
    set_messages([]);
    set_error(null);
    set_input('');
    set_thread_loading(false);
  }

  // The URL is the source of truth for the open conversation, so leaving the page (e.g. via a
  // citation) and coming back restores the same thread.
  useEffect(() => {
    if (!route_conversation_id) {
      resetThread();
      return;
    }
    // A just-created conversation is already on screen; its URL was only swapped in afterwards.
    if (route_conversation_id === conversation_id) return;

    let cancelled = false;
    const loadThread = async () => {
      set_thread_loading(true);
      set_error(null);
      try {
        const { messages: raw } = await ApiClient.getConversation(route_conversation_id);
        if (cancelled) return;
        set_conversation_id(route_conversation_id);
        set_messages(toDisplayTurns(raw));
      } catch (err) {
        if (cancelled) return;
        resetThread();
        set_error(err instanceof Error ? err.message : 'Failed to load conversation.');
      } finally {
        if (!cancelled) set_thread_loading(false);
      }
    };
    void loadThread();
    return () => {
      cancelled = true;
    };
  }, [route_conversation_id]);

  function selectConversation(id: string) {
    if (id === conversation_id) return;
    navigate(chatPath(id));
  }

  function startNewChat() {
    resetThread();
    navigate('/chat');
    input_ref.current?.focus();
  }

  async function deleteConversation(target: Conversation) {
    if (!window.confirm(`Delete "${target.title ?? 'Untitled'}"? This can't be undone.`)) return;
    set_deleting_id(target.conversation_id);
    set_error(null);
    try {
      await ApiClient.deleteConversation(target.conversation_id);
      set_conversations((list) => list.filter((c) => c.conversation_id !== target.conversation_id));
      if (target.conversation_id === conversation_id) {
        resetThread();
        navigate('/chat', { replace: true });
      }
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to delete conversation.');
    } finally {
      set_deleting_id(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || pending) return;

    set_messages((m) => [...m, { role: 'user', text: trimmed }]);
    set_input('');
    set_pending(true);
    set_error(null);

    try {
      const res = await ApiClient.runAgent({
        agent_id: NOTES_RECALL_AGENT_ID,
        input: trimmed,
        conversation_id: conversation_id ?? undefined,
      });

      if (res.conversation_id && !conversation_id) {
        set_conversation_id(res.conversation_id);
        navigate(chatPath(res.conversation_id), { replace: true });
        void loadConversations();
      }

      const reply = res.final_output_text ?? '(no response)';
      set_messages((m) => [...m, { role: 'assistant', text: reply, citations: res.citations }]);
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to reach the agent.');
    } finally {
      set_pending(false);
    }
  }

  return (
    <div className="chat-page">
      <aside className="chat-sidebar" aria-label="Conversations">
        <div className="chat-sidebar-header">
          <span className="chat-sidebar-title">Chats</span>
          <button type="button" className="primary small" onClick={startNewChat}>
            <Icon name="plus" size={14} />
            New chat
          </button>
        </div>
        {conv_loading ? (
          <div className="chat-sidebar-spinner"><Spinner /></div>
        ) : conversations.length === 0 ? (
          <p className="chat-sidebar-empty">No conversations yet.</p>
        ) : (
          <ul className="chat-conv-list">
            {conversations.map((c) => {
              const is_active = conversation_id === c.conversation_id;
              const title = c.title ?? 'Untitled';
              return (
                <li key={c.conversation_id} className={`chat-conv-item${is_active ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="chat-conv-select"
                    aria-current={is_active ? 'page' : undefined}
                    onClick={() => selectConversation(c.conversation_id)}
                  >
                    <span className="chat-conv-title">{title}</span>
                    <span className="chat-conv-date" title={DateFormat.full(c.updated_at)}>
                      {DateFormat.relative(c.updated_at)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-conv-delete ghost danger icon-button"
                    title="Delete chat"
                    aria-label={`Delete ${title}`}
                    disabled={deleting_id !== null || (pending && is_active)}
                    onClick={() => void deleteConversation(c)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="chat-main">
        <div className="chat-thread" ref={thread_ref}>
          <div className="chat-thread-inner">
            {thread_loading ? (
              <div className="chat-thread-status"><Spinner label="Loading conversation…" /></div>
            ) : messages.length === 0 && !pending ? (
              <EmptyState icon="sparkle" title="Ask your notes anything" plain>
                Answers cite the notes they draw on, so you can jump straight to the source.
              </EmptyState>
            ) : (
              messages.map((m, i) => (
                <ChatMessage key={i} role={m.role} text={m.text} citations={m.citations} />
              ))
            )}
            {pending && <ChatTypingIndicator />}
          </div>
        </div>

        <div className="chat-composer-wrap">
          {error && <div className="page-error" role="alert">{error}</div>}
          <form className="chat-composer" onSubmit={handleSubmit}>
            <textarea
              ref={input_ref}
              value={input}
              onChange={(e) => set_input(e.target.value)}
              placeholder="Ask about your notes…"
              aria-label="Message"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSubmit(e);
                }
              }}
            />
            <button
              type="submit"
              className="primary icon-button chat-send"
              disabled={pending || !input.trim()}
              title="Send"
              aria-label="Send"
            >
              <Icon name="send" size={17} />
            </button>
          </form>
          <p className="chat-composer-hint">
            <kbd className="kbd">Enter</kbd> to send · <kbd className="kbd">Shift</kbd>
            <kbd className="kbd">Enter</kbd> for a new line
          </p>
        </div>
      </section>
    </div>
  );
}
