import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient } from '../lib/api_client';
import { NOTES_RECALL_AGENT_ID } from '../lib/agent.types';
import type { Citation, Conversation, ConversationMessage } from '../lib/agent.types';
import { ChatMessage } from '../components/chat_message';
import { Spinner } from '../components/spinner';

type Turn = { role: 'user' | 'assistant'; text: string; citations?: Citation[] };

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

export function ChatPage() {
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

  async function selectConversation(id: string) {
    if (id === conversation_id) return;
    set_thread_loading(true);
    set_error(null);
    try {
      const { messages: raw } = await ApiClient.getConversation(id);
      set_conversation_id(id);
      set_messages(toDisplayTurns(raw));
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to load conversation.');
    } finally {
      set_thread_loading(false);
    }
  }

  function startNewChat() {
    set_conversation_id(null);
    set_messages([]);
    set_error(null);
    set_input('');
  }

  async function deleteConversation(target: Conversation) {
    if (!window.confirm(`Delete "${target.title ?? 'Untitled'}"? This can't be undone.`)) return;
    set_deleting_id(target.conversation_id);
    set_error(null);
    try {
      await ApiClient.deleteConversation(target.conversation_id);
      set_conversations((list) => list.filter((c) => c.conversation_id !== target.conversation_id));
      if (target.conversation_id === conversation_id) startNewChat();
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
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">
          <button onClick={startNewChat}>+ New Chat</button>
        </div>
        {conv_loading ? (
          <div className="chat-sidebar-spinner"><Spinner /></div>
        ) : conversations.length === 0 ? (
          <p className="chat-sidebar-empty">No conversations yet.</p>
        ) : (
          <ul className="chat-conv-list">
            {conversations.map((c) => (
              <li
                key={c.conversation_id}
                className={`chat-conv-item${conversation_id === c.conversation_id ? ' active' : ''}`}
                onClick={() => void selectConversation(c.conversation_id)}
              >
                <div className="chat-conv-text">
                  <span className="chat-conv-title">{c.title ?? 'Untitled'}</span>
                  <span className="chat-conv-date">
                    {new Date(c.updated_at).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  className="chat-conv-delete"
                  title="Delete chat"
                  aria-label={`Delete ${c.title ?? 'Untitled'}`}
                  disabled={deleting_id !== null || (pending && c.conversation_id === conversation_id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteConversation(c);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="chat-main">
        <div className="chat-thread" ref={thread_ref}>
          {thread_loading ? (
            <Spinner label="Loading…" />
          ) : messages.length === 0 && !pending ? (
            <p className="empty-state">Ask the agent something about your notes.</p>
          ) : (
            messages.map((m, i) => (
              <ChatMessage key={i} role={m.role} text={m.text} citations={m.citations} />
            ))
          )}
          {pending && (
            <div className="chat-message chat-message-assistant">
              <div className="chat-message-role">Assistant</div>
              <Spinner label="thinking…" />
            </div>
          )}
        </div>

        {error && <div className="page-error">{error}</div>}

        <form className="chat-input" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={(e) => set_input(e.target.value)}
            placeholder="Ask about your notes…"
            rows={2}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit(e);
              }
            }}
          />
          <button type="submit" disabled={pending || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
