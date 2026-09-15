import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiClient } from '../../lib/api_client';
import { NOTES_RECALL_AGENT_ID } from '../../lib/agent.types';
import type { Conversation } from '../../lib/agent.types';
import type { Note } from '../../lib/note.types';
import { CitationText } from '../../lib/citation_text';
import { AppRail } from '../components/app_rail';
import { VerifyBanner } from '../components/verify_banner';
import { ConfirmDialog } from '../components/confirm_dialog';
import { useToast } from '../components/toast';
import { ThreadList } from '../components/assistant/thread_list';
import { AssistantHeader } from '../components/assistant/assistant_header';
import { ChatView } from '../components/assistant/chat_view';
import { VoiceView } from '../components/assistant/voice_view';
import { SessionRail } from '../components/assistant/session_rail';
import type { ChatTurn } from '../lib/assistant.types';
import { BetaRoutes } from '../lib/beta_routes';
import type { AssistantMode } from '../lib/beta_routes';
import { ConversationTurns } from '../lib/conversation_turns';
import { Hotkey } from '../lib/hotkey';
import type { HotkeySpec } from '../lib/hotkey';
import { useHotkey } from '../lib/use_hotkey';
import { usePersistedFlag } from '../lib/use_persisted_flag';

const NEW_THREAD_HOTKEY: HotkeySpec = { mod: true, key: 'j' };
const LIST_TOGGLE_HOTKEY: HotkeySpec = { mod: true, shift: true, code: 'Backslash' };
const CONVERSATION_PAGE_SIZE = 50;

export function AssistantPage() {
  const { conversation_id: route_conversation_id } = useParams<{ conversation_id: string }>();
  const [search_params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const mode: AssistantMode = search_params.get('mode') === 'voice' ? 'voice' : 'chat';

  const [conversations, set_conversations] = useState<Conversation[]>([]);
  const [conv_loading, set_conv_loading] = useState(true);
  const [turns, set_turns] = useState<ChatTurn[]>([]);
  const [conversation_id, set_conversation_id] = useState<string | null>(null);
  const [pending, set_pending] = useState(false);
  const [thread_loading, set_thread_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [busy_id, set_busy_id] = useState<string | null>(null);
  const [thread_to_delete, set_thread_to_delete] = useState<Conversation | null>(null);
  const [list_collapsed, set_list_collapsed] = usePersistedFlag('cortex.listCollapsed', false);

  // Pinned threads can be older than the most recent page, so they are fetched on their own.
  const loadConversations = useCallback(async () => {
    try {
      const [recent, pinned] = await Promise.all([
        ApiClient.listConversations({ limit: CONVERSATION_PAGE_SIZE }),
        ApiClient.listConversations({ limit: CONVERSATION_PAGE_SIZE, pinned: true }),
      ]);
      const by_id = new Map([...recent, ...pinned].map((c) => [c.conversation_id, c]));
      set_conversations([...by_id.values()]);
    } catch {
      // Non-fatal: the list just stays empty.
    } finally {
      set_conv_loading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  function resetThread() {
    set_conversation_id(null);
    set_turns([]);
    set_error(null);
    set_thread_loading(false);
  }

  // The URL is the source of truth for the open thread, so leaving through a citation and
  // coming back restores it.
  useEffect(() => {
    if (!route_conversation_id) {
      resetThread();
      return;
    }
    // A just-created conversation is already on screen; its URL was only swapped in afterwards.
    if (route_conversation_id === conversation_id) return;

    let cancelled = false;
    async function loadThread(id: string) {
      set_thread_loading(true);
      set_error(null);
      try {
        const { messages } = await ApiClient.getConversation(id);
        if (cancelled) return;
        set_conversation_id(id);
        set_turns(ConversationTurns.fromMessages(messages));
      } catch (err) {
        if (cancelled) return;
        resetThread();
        set_error(err instanceof Error ? err.message : 'Failed to load conversation.');
      } finally {
        if (!cancelled) set_thread_loading(false);
      }
    }
    void loadThread(route_conversation_id);
    return () => {
      cancelled = true;
    };
    // conversation_id is read only to skip the reload for a thread this page just created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route_conversation_id]);

  function setMode(next: AssistantMode) {
    navigate(BetaRoutes.chat({ conversation_id, mode: next }), { replace: true });
  }

  function selectConversation(id: string) {
    if (id === conversation_id) return;
    navigate(BetaRoutes.chat({ conversation_id: id, mode }));
  }

  function startNewThread() {
    resetThread();
    navigate(BetaRoutes.chat({ mode }));
  }

  useHotkey(NEW_THREAD_HOTKEY, startNewThread);
  useHotkey(LIST_TOGGLE_HOTKEY, () => set_list_collapsed((c) => !c));

  async function send(text: string) {
    if (pending) return;
    const now = new Date().toISOString();
    set_turns((current) => [...current, { id: `local-user-${now}`, role: 'user', text, created_at: now }]);
    set_pending(true);
    set_error(null);
    try {
      const res = await ApiClient.runAgent({
        agent_id: NOTES_RECALL_AGENT_ID,
        input: text,
        conversation_id: conversation_id ?? undefined,
      });
      if (res.conversation_id && !conversation_id) {
        set_conversation_id(res.conversation_id);
        navigate(BetaRoutes.chat({ conversation_id: res.conversation_id, mode }), { replace: true });
      }
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
      // Titles are generated server-side after the first turn, and updated_at moves on every turn.
      void loadConversations();
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Failed to reach the assistant.');
    } finally {
      set_pending(false);
    }
  }

  async function saveTurnAsNote(turn: ChatTurn): Promise<Note> {
    const { note } = await ApiClient.createNote({
      title: ConversationTurns.noteTitleFrom(turn.text),
      body: CitationText.toPlainWithSources(turn.text, turn.citations),
    });
    return note;
  }

  async function togglePin(target: Conversation) {
    set_busy_id(target.conversation_id);
    try {
      const { conversation } = await ApiClient.setConversationPinned(target.conversation_id, !target.is_pinned);
      set_conversations((list) => list.map((c) => (c.conversation_id === conversation.conversation_id ? { ...c, is_pinned: conversation.is_pinned } : c)));
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Couldn't update the thread.", tone: 'error' });
    } finally {
      set_busy_id(null);
    }
  }

  async function confirmDeleteThread() {
    const target = thread_to_delete;
    if (!target) return;
    set_busy_id(target.conversation_id);
    try {
      await ApiClient.deleteConversation(target.conversation_id);
      set_conversations((list) => list.filter((c) => c.conversation_id !== target.conversation_id));
      set_thread_to_delete(null);
      if (target.conversation_id === conversation_id) {
        resetThread();
        navigate(BetaRoutes.chat({ mode }), { replace: true });
      }
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Couldn't delete the thread.", tone: 'error' });
    } finally {
      set_busy_id(null);
    }
  }

  const current_title = conversations.find((c) => c.conversation_id === conversation_id)?.title ?? (conversation_id ? 'Untitled' : 'New thread');

  return (
    <div className="workspace">
      <AppRail action={{ label: 'New thread', icon: 'plus', shortcut_label: Hotkey.label(NEW_THREAD_HOTKEY, 'J'), onClick: startNewThread }} />

      {!list_collapsed && (
        <ThreadList
          conversations={conversations}
          loading={conv_loading}
          selected_id={conversation_id}
          busy_id={busy_id}
          onSelect={selectConversation}
          onTogglePin={(c) => void togglePin(c)}
          onDelete={set_thread_to_delete}
        />
      )}

      <div className="workspace-main">
        <VerifyBanner />
        <AssistantHeader
          title={current_title}
          thinking={pending}
          mode={mode}
          list_collapsed={list_collapsed}
          onToggleList={() => set_list_collapsed((c) => !c)}
          onModeChange={setMode}
        />
        {mode === 'chat' ? (
          <ChatView
            turns={turns}
            pending={pending}
            thread_loading={thread_loading}
            error={error}
            onSend={(text) => void send(text)}
            onSaveAsNote={saveTurnAsNote}
          />
        ) : (
          <VoiceView />
        )}
      </div>

      <SessionRail turns={turns} mode={mode} />

      <ConfirmDialog
        open={!!thread_to_delete}
        title={`Delete “${thread_to_delete?.title ?? 'Untitled'}”?`}
        confirm_label="Delete thread"
        danger
        busy={busy_id === thread_to_delete?.conversation_id}
        onConfirm={() => void confirmDeleteThread()}
        onCancel={() => set_thread_to_delete(null)}
      >
        <p>The conversation is removed from your threads.</p>
      </ConfirmDialog>
    </div>
  );
}
