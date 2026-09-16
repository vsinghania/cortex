import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiClient } from '../../lib/api_client';
import type { Conversation } from '../../lib/agent.types';
import { AppRail } from '../components/app_rail';
import { MobileShell } from '../components/mobile/mobile_shell';
import { MobileBar, MobileBarButton, MobileBarTitle } from '../components/mobile/mobile_bar';
import { BottomSheet } from '../components/mobile/bottom_sheet';
import { RadialFab } from '../components/mobile/radial_fab';
import { MobileThreadBar } from '../components/assistant/mobile_thread_bar';
import { ThemeToggleButton } from '../components/theme_toggle_button';
import { VerifyBanner } from '../components/verify_banner';
import { ConfirmDialog } from '../components/confirm_dialog';
import { useToast } from '../components/toast';
import { ThreadList } from '../components/assistant/thread_list';
import { AssistantHeader } from '../components/assistant/assistant_header';
import { ChatView } from '../components/assistant/chat_view';
import { VoiceView } from '../components/assistant/voice_view';
import { SessionRail } from '../components/assistant/session_rail';
import { BetaRoutes } from '../lib/beta_routes';
import type { AssistantMode } from '../lib/beta_routes';
import { Hotkey } from '../lib/hotkey';
import type { HotkeySpec } from '../lib/hotkey';
import { useChatThread } from '../lib/use_chat_thread';
import { useHotkey } from '../lib/use_hotkey';
import { useIsMobile } from '../lib/use_is_mobile';
import { useChromeCollapse } from '../lib/use_chrome_collapse';
import { Plural } from '../lib/plural';
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
  const is_mobile = useIsMobile();
  const chrome = useChromeCollapse<HTMLDivElement>();
  const is_new_thread = route_conversation_id === BetaRoutes.NEW_THREAD_SEGMENT;
  // A composed-but-unsent thread has a route but no id to load.
  const loaded_conversation_id = is_new_thread ? undefined : route_conversation_id;

  const [conversations, set_conversations] = useState<Conversation[]>([]);
  const [conv_loading, set_conv_loading] = useState(true);
  const thread = useChatThread();
  const { conversation_id } = thread;
  const [busy_id, set_busy_id] = useState<string | null>(null);
  const [thread_to_delete, set_thread_to_delete] = useState<Conversation | null>(null);
  const [info_open, set_info_open] = useState(false);
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

  // The URL is the source of truth for the open thread, so leaving through a citation and
  // coming back restores it.
  useEffect(() => {
    if (!loaded_conversation_id) {
      thread.reset();
      return;
    }
    // A just-created conversation is already on screen; its URL was only swapped in afterwards.
    if (loaded_conversation_id === conversation_id) return;
    void thread.loadThread(loaded_conversation_id);
    // conversation_id is read only to skip the reload for a thread this page just created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded_conversation_id]);

  function setMode(next: AssistantMode) {
    // An unsent thread has no id yet, so the mode switch has to carry the `new` segment or
    // the route would fall back to the thread list.
    navigate(BetaRoutes.chat({ conversation_id: detail_conversation_id, mode: next }), { replace: true });
  }

  function selectConversation(id: string) {
    if (id === conversation_id) return;
    navigate(BetaRoutes.chat({ conversation_id: id, mode }));
  }

  function startNewThread() {
    thread.reset();
    navigate(BetaRoutes.chat({ conversation_id: BetaRoutes.NEW_THREAD_SEGMENT, mode }));
  }

  useHotkey(NEW_THREAD_HOTKEY, startNewThread);
  useHotkey(LIST_TOGGLE_HOTKEY, () => set_list_collapsed((c) => !c));

  async function send(text: string) {
    const result = await thread.send(text);
    if (!result) return;
    if (result.applied && result.created && result.conversation_id) {
      navigate(BetaRoutes.chat({ conversation_id: result.conversation_id, mode }), { replace: true });
    }
    // Titles are generated server-side after the first turn, and updated_at moves on every turn.
    void loadConversations();
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
        thread.reset();
        navigate(BetaRoutes.chat({ mode }), { replace: true });
      }
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Couldn't delete the thread.", tone: 'error' });
    } finally {
      set_busy_id(null);
    }
  }

  /** What the detail screen's URL should carry: the real id, or the unsent-thread segment. */
  const detail_conversation_id = conversation_id ?? (is_new_thread ? BetaRoutes.NEW_THREAD_SEGMENT : null);
  const current_conversation = conversations.find((c) => c.conversation_id === conversation_id) ?? null;
  const current_title = current_conversation?.title ?? (conversation_id ? 'Untitled' : 'New thread');

  const rail = (variant: 'rail' | 'drawer', onClose?: () => void) => (
    <AppRail
      variant={variant}
      onClose={onClose}
      action={{ label: 'New thread', icon: 'plus', shortcut_label: Hotkey.label(NEW_THREAD_HOTKEY, 'J'), onClick: startNewThread }}
    />
  );

  const thread_list = (
    <ThreadList
      conversations={conversations}
      loading={conv_loading}
      selected_id={conversation_id}
      busy_id={busy_id}
      onSelect={selectConversation}
      onTogglePin={(c) => void togglePin(c)}
      onDelete={set_thread_to_delete}
    />
  );

  const conversation_view = mode === 'chat' ? (
    <ChatView
      turns={thread.turns}
      pending={thread.pending}
      thread_loading={thread.thread_loading}
      error={thread.error}
      onSend={(text) => void send(text)}
      onSaveAsNote={thread.saveTurnAsNote}
    />
  ) : (
    <VoiceView />
  );

  const delete_dialog = (
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
  );

  if (is_mobile) {
    const show_detail = !!route_conversation_id || mode === 'voice';
    return (
      <MobileShell
        rail={(close) => rail('drawer', close)}
        show_tabs={!show_detail}
        fab={
          <RadialFab
            label="New thread"
            default_key="chat"
            actions={[
              { key: 'chat', label: 'New chat', icon: 'sparkle', onSelect: startNewThread },
              { key: 'voice', label: 'Voice chat', icon: 'mic', onSelect: () => navigate(BetaRoutes.chat({ conversation_id: BetaRoutes.NEW_THREAD_SEGMENT, mode: 'voice' })) },
              { key: 'note', label: 'New note', icon: 'file_plus', onSelect: () => navigate(BetaRoutes.newNote()) },
            ]}
          />
        }
      >
        {(openDrawer) => (
          <div className="m-body" ref={chrome.ref}>
            {show_detail ? (
              <>
                <MobileThreadBar
                  title={current_title}
                  thinking={thread.pending}
                  mode={mode}
                  onBack={() => navigate(BetaRoutes.chat())}
                  onOpenInfo={() => set_info_open(true)}
                  onModeChange={setMode}
                />
                {conversation_view}
                <BottomSheet open={info_open} title="Session" onClose={() => set_info_open(false)}>
                  <SessionRail turns={thread.turns} mode={mode} conversation={current_conversation} />
                </BottomSheet>
              </>
            ) : (
              <>
                <div className="m-chrome" data-collapsed={chrome.collapsed}>
                  <div className="m-chrome-inner">
                    <MobileBar>
                      <MobileBarButton label="Menu" icon="menu" onClick={openDrawer} />
                      <MobileBarTitle title="Assistant" subtitle={Plural.count(conversations.length, 'thread')} />
                      <ThemeToggleButton />
                    </MobileBar>
                    <VerifyBanner />
                  </div>
                </div>
                {thread_list}
              </>
            )}
            {delete_dialog}
          </div>
        )}
      </MobileShell>
    );
  }

  return (
    <div className="workspace">
      {rail('rail')}

      {!list_collapsed && thread_list}

      <div className="workspace-main">
        <VerifyBanner />
        <AssistantHeader
          title={current_title}
          thinking={thread.pending}
          mode={mode}
          list_collapsed={list_collapsed}
          onToggleList={() => set_list_collapsed((c) => !c)}
          onModeChange={setMode}
        />
        {conversation_view}
      </div>

      <SessionRail turns={thread.turns} mode={mode} conversation={current_conversation} />

      {delete_dialog}
    </div>
  );
}
