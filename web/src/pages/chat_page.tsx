import { useEffect, useRef, useState } from 'react';
import { ApiClient } from '../lib/api_client';
import { NOTES_RECALL_AGENT_ID } from '../lib/agent.types';
import { ChatMessage } from '../components/chat_message';
import { Spinner } from '../components/spinner';

type Turn = { role: 'user' | 'assistant'; text: string };

export function ChatPage() {
  const [messages, set_messages] = useState<Turn[]>([]);
  const [input, set_input] = useState('');
  const [conversation_id, set_conversation_id] = useState<string | null>(null);
  const [pending, set_pending] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const thread_ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    thread_ref.current?.scrollTo({ top: thread_ref.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

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
      }
      const reply = res.final_output_text ?? '(no response)';
      set_messages((m) => [...m, { role: 'assistant', text: reply }]);
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to reach the agent.');
    } finally {
      set_pending(false);
    }
  }

  return (
    <div className="page chat-page">
      <header className="page-header">
        <h1>Chat</h1>
        {conversation_id && (
          <span className="chat-conversation-id" title="Conversation id">
            #{conversation_id.slice(0, 8)}
          </span>
        )}
      </header>

      <div className="chat-thread" ref={thread_ref}>
        {messages.length === 0 && !pending && (
          <p className="empty-state">Ask the agent something about your notes.</p>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} role={m.role} text={m.text} />
        ))}
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
  );
}
