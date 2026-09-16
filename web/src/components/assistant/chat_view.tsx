import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Note } from '../../lib/note.types';
import { useAutosize } from '../../lib/use_autosize';
import { Icon } from '../icon';
import type { ChatTurn } from '../../lib/assistant.types';
import { ChatMessage } from './chat_message';

const COMPOSER_MAX_HEIGHT_PX = 160;

const DEFAULT_SUGGESTIONS = [
  'Summarise what I wrote this week',
  'What are my open tasks?',
  'What have I noted about my current projects?',
  "Which ideas haven't I followed up on?",
];

const DEFAULT_WELCOME = (
  <>
    <h1>What are we thinking about?</h1>
    <p>I can read across every note in your workspace - summarise, connect, pressure-test, or just talk it through.</p>
  </>
);

type Props = {
  turns: ChatTurn[];
  pending: boolean;
  thread_loading: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onSaveAsNote: (turn: ChatTurn) => Promise<Note>;
  /** `panel` fits the chat into a side rail: tighter spacing, no centred column. */
  variant?: 'page' | 'panel';
  welcome?: ReactNode;
  suggestions?: string[];
  placeholder?: string;
};

export function ChatView({
  turns,
  pending,
  thread_loading,
  error,
  onSend,
  onSaveAsNote,
  variant = 'page',
  welcome = DEFAULT_WELCOME,
  suggestions = DEFAULT_SUGGESTIONS,
  placeholder = 'Ask about your notes, or start a thought…',
}: Props) {
  const [draft, set_draft] = useState('');
  const scroll_ref = useRef<HTMLDivElement>(null);
  const input_ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(input_ref, draft, COMPOSER_MAX_HEIGHT_PX);

  useEffect(() => {
    scroll_ref.current?.scrollTo({ top: scroll_ref.current.scrollHeight, behavior: 'smooth' });
  }, [turns, pending]);

  function submit() {
    const text = draft.trim();
    if (!text || pending) return;
    onSend(text);
    set_draft('');
  }

  const can_send = !!draft.trim() && !pending;

  return (
    <div className={`chat${variant === 'panel' ? ' chat-panel' : ''}`}>
      <div className="chat-scroll" ref={scroll_ref}>
        <div className="chat-column">
          {thread_loading ? (
            <div className="chat-status"><span className="dots" aria-label="Loading conversation"><i /><i /><i /></span></div>
          ) : turns.length === 0 && !pending ? (
            <div className="welcome">
              <Icon name="hexagon" size={30} className="welcome-mark" />
              {welcome}
              <div className="suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="suggestion" onClick={() => onSend(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => <ChatMessage key={turn.id} turn={turn} onSaveAsNote={onSaveAsNote} />)
          )}
          {pending && (
            <div className="msg msg-assistant" role="status">
              <span className="msg-avatar" aria-hidden="true"><Icon name="hexagon" size={14} /></span>
              <span className="dots msg-typing" aria-label="Searching your notes"><i /><i /><i /></span>
            </div>
          )}
        </div>
      </div>

      <div className="composer-wrap">
        <div className="chat-column">
          {error && <div className="form-error" role="alert">{error}</div>}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <textarea
              ref={input_ref}
              value={draft}
              rows={1}
              onChange={(e) => set_draft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={placeholder}
              aria-label="Message"
            />
            <div className="composer-footer">
              <span className="composer-hint">⏎ send · ⇧⏎ newline</span>
              <button type="submit" className="send-btn" disabled={!can_send} aria-label="Send" title="Send">
                <Icon name="send" size={15} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
