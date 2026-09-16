import { useCallback, useRef, useState } from 'react';
import { ApiClient } from './api_client';
import { NOTES_RECALL_AGENT_ID } from './agent.types';
import type { ContextRef } from './agent.types';
import type { Note } from './note.types';
import { CitationText } from './citation_text';
import type { ChatTurn } from './assistant.types';
import { ConversationTurns } from './conversation_turns';

export type SendOptions = {
  /** Anchors a brand-new thread to a document; ignored once the thread exists. */
  context_ref?: ContextRef;
  /** Awaited before the request, e.g. to flush an editor's pending autosave. */
  beforeSend?: () => Promise<void>;
};

export type SendResult = {
  conversation_id: string | null;
  /** True when this send started the thread. */
  created: boolean;
  /** False when the user moved to another thread before the reply landed, so it was not shown. */
  applied: boolean;
};

export type ChatThread = {
  turns: ChatTurn[];
  conversation_id: string | null;
  pending: boolean;
  thread_loading: boolean;
  error: string | null;
  loadThread: (conversation_id: string) => Promise<void>;
  reset: () => void;
  send: (text: string, options?: SendOptions) => Promise<SendResult | null>;
  saveTurnAsNote: (turn: ChatTurn) => Promise<Note>;
};

/**
 * One conversation's turns and the request lifecycle around them. Every load, reset and send
 * bumps a generation so a reply that lands after the user moved to another thread is dropped
 * rather than appended to the wrong one.
 */
export function useChatThread(): ChatThread {
  const [turns, set_turns] = useState<ChatTurn[]>([]);
  const [conversation_id, set_conversation_id] = useState<string | null>(null);
  const [pending, set_pending] = useState(false);
  const [thread_loading, set_thread_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const generation_ref = useRef(0);
  const conversation_id_ref = useRef<string | null>(null);
  const pending_ref = useRef(false);

  const applyConversationId = useCallback((id: string | null) => {
    conversation_id_ref.current = id;
    set_conversation_id(id);
  }, []);

  const applyPending = useCallback((value: boolean) => {
    pending_ref.current = value;
    set_pending(value);
  }, []);

  const reset = useCallback(() => {
    generation_ref.current += 1;
    applyConversationId(null);
    applyPending(false);
    set_turns([]);
    set_error(null);
    set_thread_loading(false);
  }, [applyConversationId, applyPending]);

  const loadThread = useCallback(
    async (id: string) => {
      const generation = ++generation_ref.current;
      applyPending(false);
      set_thread_loading(true);
      set_error(null);
      try {
        const { messages } = await ApiClient.getConversation(id);
        if (generation !== generation_ref.current) return;
        applyConversationId(id);
        set_turns(ConversationTurns.fromMessages(messages));
      } catch (err) {
        if (generation !== generation_ref.current) return;
        applyConversationId(null);
        set_turns([]);
        set_error(err instanceof Error ? err.message : 'Failed to load conversation.');
      } finally {
        if (generation === generation_ref.current) set_thread_loading(false);
      }
    },
    [applyConversationId, applyPending],
  );

  const send = useCallback(
    async (text: string, options: SendOptions = {}): Promise<SendResult | null> => {
      if (pending_ref.current) return null;
      const generation = generation_ref.current;
      const now = new Date().toISOString();
      set_turns((current) => [...current, { id: `local-user-${now}`, role: 'user', text, created_at: now }]);
      applyPending(true);
      set_error(null);
      try {
        await options.beforeSend?.();
        const existing_id = conversation_id_ref.current;
        const res = await ApiClient.runAgent({
          agent_id: NOTES_RECALL_AGENT_ID,
          input: text,
          conversation_id: existing_id ?? undefined,
          context_ref: existing_id ? undefined : options.context_ref,
        });
        const created = !existing_id && !!res.conversation_id;
        if (generation !== generation_ref.current) {
          return { conversation_id: res.conversation_id ?? null, created, applied: false };
        }
        if (created) applyConversationId(res.conversation_id ?? null);
        const replied_at = new Date().toISOString();
        set_turns((current) => [
          ...current,
          {
            id: `local-assistant-${replied_at}`,
            role: 'assistant',
            text: res.final_output_text ?? '(no response)',
            citations: res.citations,
            created_at: replied_at,
          },
        ]);
        return { conversation_id: res.conversation_id ?? existing_id, created, applied: true };
      } catch (err) {
        if (generation === generation_ref.current) {
          set_error(err instanceof Error ? err.message : 'Failed to reach the assistant.');
        }
        return null;
      } finally {
        if (generation === generation_ref.current) applyPending(false);
      }
    },
    [applyConversationId, applyPending],
  );

  const saveTurnAsNote = useCallback(async (turn: ChatTurn): Promise<Note> => {
    const { note } = await ApiClient.createNote({
      title: ConversationTurns.noteTitleFrom(turn.text),
      body: CitationText.toPlainWithSources(turn.text, turn.citations),
    });
    return note;
  }, []);

  return { turns, conversation_id, pending, thread_loading, error, loadThread, reset, send, saveTurnAsNote };
}
