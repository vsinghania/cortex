import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceSession } from '../lib/voice_session';
import type {
  VoiceSessionStatus,
  VoiceToolEvent,
  VoiceTranscriptEvent,
} from '../lib/voice.types';
import { Icon } from '../components/icon';

type TranscriptLine = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

const STATUS_LABEL: Record<VoiceSessionStatus, string> = {
  idle: 'Ready',
  connecting: 'Connecting…',
  listening: 'Listening',
  closed: 'Stopped',
  error: 'Error',
};

export function VoiceCapturePage() {
  const [status, set_status] = useState<VoiceSessionStatus>('idle');
  const [error, set_error] = useState<string | null>(null);
  const [transcript_lines, set_transcript_lines] = useState<TranscriptLine[]>([]);
  const [tool_events, set_tool_events] = useState<VoiceToolEvent[]>([]);
  const session_ref = useRef<VoiceSession | null>(null);
  const transcript_id_ref = useRef(0);
  const assistant_streaming_ref = useRef<number | null>(null);
  const transcript_scroll_ref = useRef<HTMLDivElement>(null);

  const handleTranscript = useCallback((event: VoiceTranscriptEvent) => {
    set_transcript_lines((lines) => {
      if (event.role === 'assistant' && !event.is_final && assistant_streaming_ref.current !== null) {
        const id = assistant_streaming_ref.current;
        return lines.map((l) => (l.id === id ? { ...l, text: event.text } : l));
      }
      if (event.role === 'assistant' && !event.is_final) {
        const id = ++transcript_id_ref.current;
        assistant_streaming_ref.current = id;
        return [...lines, { id, role: 'assistant', text: event.text }];
      }
      if (event.role === 'assistant' && event.is_final) {
        const id = assistant_streaming_ref.current;
        assistant_streaming_ref.current = null;
        if (id !== null) {
          return lines.map((l) => (l.id === id ? { ...l, text: event.text } : l));
        }
      }
      const id = ++transcript_id_ref.current;
      return [...lines, { id, role: event.role, text: event.text }];
    });
  }, []);

  const handleTool = useCallback((event: VoiceToolEvent) => {
    set_tool_events((events) => [...events, event]);
  }, []);

  const handleError = useCallback((message: string) => {
    set_error(message);
  }, []);

  useEffect(() => {
    transcript_scroll_ref.current?.scrollTo({
      top: transcript_scroll_ref.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [transcript_lines, tool_events]);

  useEffect(() => {
    return () => {
      session_ref.current?.stop();
      session_ref.current = null;
    };
  }, []);

  async function startSession() {
    if (session_ref.current) return;
    set_error(null);
    set_transcript_lines([]);
    set_tool_events([]);
    transcript_id_ref.current = 0;
    assistant_streaming_ref.current = null;
    try {
      session_ref.current = await VoiceSession.start({
        onStatus: set_status,
        onTranscript: handleTranscript,
        onTool: handleTool,
        onError: handleError,
      });
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to start voice session.');
      session_ref.current = null;
    }
  }

  function stopSession() {
    session_ref.current?.stop();
    session_ref.current = null;
  }

  const is_active = status === 'connecting' || status === 'listening';
  const button_label = is_active ? 'Stop recording' : status === 'error' ? 'Retry' : 'Start recording';
  const button_class = [
    'voice-button',
    status === 'listening' && 'voice-button-active',
    status === 'connecting' && 'voice-button-connecting',
  ].filter(Boolean).join(' ');

  return (
    <div className="voice-page">
      <div className="voice-intro">
        <h1>Voice capture</h1>
        <p>Speak a note. Cortex reads back a summary and saves it when you say “save”.</p>
      </div>

      <div className="voice-stage">
        <button
          type="button"
          className={button_class}
          onClick={() => (is_active ? stopSession() : void startSession())}
          aria-label={button_label}
          title={button_label}
        >
          <Icon name={is_active ? 'stop' : 'mic'} size={40} />
        </button>
        <div className={`voice-status voice-status-${status}`} role="status">
          <span className="voice-status-dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </div>
        {error && <div className="voice-error" role="alert">{error}</div>}
      </div>

      <div className="voice-transcript" ref={transcript_scroll_ref}>
        {transcript_lines.length === 0 && tool_events.length === 0 ? (
          <p className="voice-transcript-empty">Your transcript will appear here.</p>
        ) : (
          <>
            {transcript_lines.map((line) => (
              <div key={line.id} className={`voice-line voice-line-${line.role}`}>
                <span className="voice-line-role">{line.role === 'user' ? 'You' : 'Cortex'}</span>
                <span className="voice-line-text">{line.text}</span>
              </div>
            ))}
            {tool_events.map((event, i) => (
              <div key={`tool-${i}`} className={`voice-tool voice-tool-${event.status}`}>
                {event.status === 'started' && `Calling ${event.tool_name}…`}
                {event.status === 'completed' && `${event.tool_name} ✓`}
                {event.status === 'failed' && `${event.tool_name} failed${event.detail ? `: ${event.detail}` : ''}`}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
