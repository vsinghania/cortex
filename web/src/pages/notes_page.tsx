import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import type { Note, NoteBulkAction, NotePatchBody, NoteTagCount } from '../lib/note.types';
import type { NoteFolderNode } from '../lib/note_folder.types';
import type { ReturnLinkState } from '../lib/navigation.types';
import { Icon } from '../components/icon';
import { AppRail } from '../components/app_rail';
import { MobileShell } from '../components/mobile/mobile_shell';
import { MobileBar, MobileBarButton, MobileBarTitle } from '../components/mobile/mobile_bar';
import { BottomSheet } from '../components/mobile/bottom_sheet';
import { MobileFolderSheet } from '../components/notes/mobile_folder_sheet';
import { RadialFab } from '../components/mobile/radial_fab';
import { ThemeToggleButton } from '../components/theme_toggle_button';
import { VerifyBanner } from '../components/verify_banner';
import { ConfirmDialog } from '../components/confirm_dialog';
import { EmptyPanel } from '../components/empty_panel';
import { useToast } from '../components/toast';
import { NotesRailSections } from '../components/notes/notes_rail_sections';
import { NotesList } from '../components/notes/notes_list';
import { NoteEditor } from '../components/notes/note_editor';
import { NoteRightRail } from '../components/notes/note_right_rail';
import type { NoteRailTab } from '../components/notes/note_right_rail';
import { AppRoutes } from '../lib/app_routes';
import { FolderTree } from '../lib/folder_tree';
import { Hotkey } from '../lib/hotkey';
import type { HotkeySpec } from '../lib/hotkey';
import { NoteFilterParams } from '../lib/note_filter_params';
import { NoteBulk } from '../lib/note_bulk';
import { Plural } from '../lib/plural';
import type { NoteDraftFields, NoteFilters, OutlineRequest } from '../lib/note_workspace.types';
import { useCurrentNote } from '../lib/use_current_note';
import { useHotkey } from '../lib/use_hotkey';
import { useIsMobile } from '../lib/use_is_mobile';
import { useChromeCollapse } from '../lib/use_chrome_collapse';
import { useNoteList } from '../lib/use_note_list';
import { useNoteSelection } from '../lib/use_note_selection';
import { usePersistedFlag } from '../lib/use_persisted_flag';
import { useRelatedNotes } from '../lib/use_related_notes';

// ⌘N and Ctrl+N belong to the browser, so new-note adds ⌥.
const NEW_NOTE_HOTKEY: HotkeySpec = { mod: true, alt: true, code: 'KeyN' };
const SEARCH_HOTKEY: HotkeySpec = { mod: true, key: 'k' };
const LIST_TOGGLE_HOTKEY: HotkeySpec = { mod: true, shift: true, code: 'Backslash' };
const CHAT_TOGGLE_HOTKEY: HotkeySpec = { mod: true, shift: true, code: 'KeyL' };

type FolderDeleteTarget = { folder: NoteFolderNode; subfolder_count: number; note_count: number };

export function NotesPage() {
  const { note_id: route_note_id } = useParams<{ note_id: string }>();
  const [search_params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const is_mobile = useIsMobile();
  const chrome = useChromeCollapse<HTMLDivElement>();

  const filters = useMemo(() => NoteFilterParams.fromSearch(search_params), [search_params]);
  const filter_search = NoteFilterParams.toSearch(filters);
  const chunk_id = search_params.get('chunk');
  const return_link = location.state as ReturnLinkState | null;
  const is_draft = route_note_id === AppRoutes.NEW_NOTE_SEGMENT;
  const selected_id = route_note_id && !is_draft ? route_note_id : null;

  const [folders, set_folders] = useState<NoteFolderNode[]>([]);
  const [tags, set_tags] = useState<NoteTagCount[]>([]);
  const [list_collapsed, set_list_collapsed] = usePersistedFlag('cortex.listCollapsed', false);
  const [chat_open, set_chat_open] = usePersistedFlag('cortex.noteChatOpen', false);
  const [sheet_tab, set_sheet_tab] = useState<NoteRailTab | null>(null);
  const [folder_sheet_open, set_folder_sheet_open] = useState(false);
  const [draft_session, set_draft_session] = useState(0);
  const [draft_note_id, set_draft_note_id] = useState<string | null>(null);
  const [note_to_delete, set_note_to_delete] = useState<Note | null>(null);
  const [notes_to_bulk_delete, set_notes_to_bulk_delete] = useState<Note[] | null>(null);
  const [bulk_busy, set_bulk_busy] = useState(false);
  const [folder_to_delete, set_folder_to_delete] = useState<FolderDeleteTarget | null>(null);
  const [dialog_busy, set_dialog_busy] = useState(false);
  const [outline_request, set_outline_request] = useState<OutlineRequest | null>(null);
  const search_ref = useRef<HTMLInputElement>(null);
  const flush_ref = useRef<(() => Promise<void>) | null>(null);

  const list = useNoteList(filters);
  const selection = useNoteSelection();
  const current = useCurrentNote(selected_id, list.find);
  const related = useRelatedNotes(current.note);
  const folders_by_id = useMemo(() => FolderTree.byId(folders), [folders]);
  const folder_tree = useMemo(() => FolderTree.build(folders), [folders]);

  const loadFolders = useCallback(async () => {
    try {
      const res = await ApiClient.listFolders();
      set_folders(res.folders);
    } catch {
      // The tree is navigation only; notes still list and open without it.
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      const res = await ApiClient.listNoteTags();
      set_tags(res.tags);
    } catch {
      set_tags([]);
    }
  }, []);

  useEffect(() => {
    void loadFolders();
    void loadTags();
  }, [loadFolders, loadTags]);

  // Once the user moves on from the note a draft became, it is an ordinary note again.
  useEffect(() => {
    if (!is_draft && selected_id !== draft_note_id) set_draft_note_id(null);
  }, [is_draft, selected_id, draft_note_id]);

  function replaceFilters(next: NoteFilters) {
    navigate({ pathname: location.pathname, search: NoteFilterParams.toSearch(next) }, { replace: true });
  }

  function selectFilters(patch: Partial<NoteFilters>) {
    const next = { ...filters, ...patch };
    navigate({ pathname: location.pathname, search: NoteFilterParams.toSearch(next) });
  }

  function openNote(note_id: string) {
    navigate(AppRoutes.note(note_id, filter_search));
  }

  function startDraft() {
    set_draft_session((n) => n + 1);
    set_draft_note_id(null);
    navigate(AppRoutes.newNote(filter_search));
  }

  useHotkey(NEW_NOTE_HOTKEY, startDraft);
  useHotkey(SEARCH_HOTKEY, () => {
    set_list_collapsed(false);
    window.requestAnimationFrame(() => search_ref.current?.focus());
  });
  useHotkey(LIST_TOGGLE_HOTKEY, () => set_list_collapsed((c) => !c));
  useHotkey(CHAT_TOGGLE_HOTKEY, () => set_chat_open((open) => !open));

  const flushEditor = useCallback(async () => {
    await flush_ref.current?.();
  }, []);

  async function handleCreate(fields: NoteDraftFields): Promise<Note> {
    const { note } = await ApiClient.createNote({
      ...fields,
      folder_id: NoteFilterParams.isRealFolder(filters.folder) ? filters.folder : undefined,
      tags: filters.tag ? [filters.tag] : undefined,
    });
    // Keeping the draft's editor mounted (same key) is what lets typing continue through the swap.
    set_draft_note_id(note.id);
    current.set(note);
    if (!filters.archived) list.prependLocal(note);
    navigate(AppRoutes.note(note.id, filter_search), { replace: true });
    void loadFolders();
    if (filters.tag) void loadTags();
    return note;
  }

  const handleSaved = useCallback(
    (note: Note) => {
      current.set(note);
      list.updateLocal(note);
    },
    // current.set and list.updateLocal are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Organises any note, from the editor toolbar or a row in the list. */
  async function organizeNote(note: Note, patch: NotePatchBody) {
    try {
      const res = await ApiClient.updateNote(note.id, patch);
      if (res.note.id === current.note?.id) current.set(res.note);
      list.updateLocal(res.note);
      if ('is_pinned' in patch || 'is_archived' in patch || 'folder_id' in patch) void list.refresh();
      if ('folder_id' in patch || 'is_archived' in patch) void loadFolders();
      if ('tags' in patch) void loadTags();
      if (patch.is_archived) {
        toast.show({ message: 'Note archived.', action: { label: 'Undo', onClick: () => void organizeNote(res.note, { is_archived: false }) } });
      }
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Couldn't update the note.", tone: 'error' });
    }
  }

  // A selection belongs to the set of notes it was made in; re-sorting keeps it, refiltering drops it.
  const { exit: exitSelection } = selection;
  useEffect(() => {
    exitSelection();
  }, [filters.folder, filters.archived, filters.tag, filters.q, exitSelection]);

  async function runBulk(action: NoteBulkAction, notes: Note[]): Promise<void> {
    const ids = notes.map((n) => n.id);
    if (ids.length === 0) return;
    set_bulk_busy(true);
    try {
      const result = await NoteBulk.apply(ids, action);
      const undo = action.action === 'archive'
        ? { label: 'Undo', onClick: () => void runBulk({ action: 'unarchive' }, notes) }
        : undefined;
      toast.show({ message: NoteBulk.summary(action, result.matched), action: undo });
      // Tagging is often done in passes, so the selection stays; every other action ends it.
      if (action.action !== 'add_tags' && action.action !== 'remove_tags') selection.exit();
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Couldn't update the selected notes.", tone: 'error' });
    } finally {
      set_bulk_busy(false);
      // Earlier batches may have applied even when a later one failed, so resync regardless.
      void syncAfterBulk(action, ids);
    }
  }

  async function syncAfterBulk(action: NoteBulkAction, ids: string[]) {
    void list.refresh();
    void loadFolders();
    void loadTags();
    if (!selected_id || !ids.includes(selected_id)) return;
    if (action.action === 'delete') {
      navigate(AppRoutes.notes(filter_search), { replace: true });
      return;
    }
    try {
      const res = await ApiClient.getNote(selected_id);
      current.set(res.note);
    } catch {
      // The toolbar just shows the old state until the note is next loaded.
    }
  }

  async function confirmBulkDelete() {
    const notes = notes_to_bulk_delete;
    if (!notes) return;
    await runBulk({ action: 'delete' }, notes);
    set_notes_to_bulk_delete(null);
  }

  async function confirmDeleteNote() {
    const note = note_to_delete;
    if (!note) return;
    set_dialog_busy(true);
    try {
      await ApiClient.deleteNote(note.id);
      const ordered = [...list.pinned, ...list.items];
      const index = ordered.findIndex((n) => n.id === note.id);
      const neighbour = ordered[index + 1] ?? ordered[index - 1];
      list.removeLocal(note.id);
      set_note_to_delete(null);
      toast.show({ message: `Deleted “${note.title}”.` });
      // Deleting from the list leaves whatever note is open alone.
      if (note.id === selected_id) {
        navigate(neighbour ? AppRoutes.note(neighbour.id, filter_search) : AppRoutes.notes(filter_search), { replace: true });
      }
      void loadFolders();
      void loadTags();
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Couldn't delete the note.", tone: 'error' });
    } finally {
      set_dialog_busy(false);
    }
  }

  async function createFolder(name: string, parent_id: string | null): Promise<boolean> {
    try {
      await ApiClient.createFolder({ name, parent_id });
      await loadFolders();
      return true;
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Couldn't create the folder.", tone: 'error' });
      return false;
    }
  }

  async function renameFolder(folder_id: string, name: string): Promise<boolean> {
    try {
      await ApiClient.updateFolder(folder_id, { name });
      await loadFolders();
      return true;
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Couldn't rename the folder.", tone: 'error' });
      return false;
    }
  }

  function requestFolderDelete(folder: NoteFolderNode) {
    set_folder_to_delete({
      folder,
      subfolder_count: FolderTree.descendants(folders, folder.id).length,
      note_count: FolderTree.subtreeNoteCount(folders, folder.id),
    });
  }

  async function confirmDeleteFolder() {
    const target = folder_to_delete;
    if (!target) return;
    set_dialog_busy(true);
    try {
      const result = await ApiClient.deleteFolder(target.folder.id);
      const root_id = target.folder.id;
      set_folder_to_delete(null);
      toast.show({ message: `Deleted ${Plural.count(result.folders_deleted, 'folder')} and ${Plural.count(result.notes_deleted, 'note')}.` });
      const viewing_deleted_folder = FolderTree.isInSubtree(folders_by_id, filters.folder, root_id);
      const editing_deleted_note = FolderTree.isInSubtree(folders_by_id, current.note?.folder_id, root_id);
      if (viewing_deleted_folder || editing_deleted_note) {
        const next_filters = viewing_deleted_folder ? { ...filters, folder: null } : filters;
        navigate(AppRoutes.notes(NoteFilterParams.toSearch(next_filters)), { replace: true });
      }
      void loadFolders();
      void loadTags();
      void list.refresh();
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Couldn't delete the folder.", tone: 'error' });
    } finally {
      set_dialog_busy(false);
    }
  }

  function dismissCitation() {
    if (!selected_id) return;
    navigate(AppRoutes.note(selected_id, filter_search), { replace: true });
  }

  const editor_key = is_draft || (selected_id !== null && selected_id === draft_note_id) ? `draft-${draft_session}` : selected_id ?? 'none';
  const editor_note = is_draft ? null : current.note?.id === selected_id ? current.note : null;
  const new_note_label = Hotkey.label(NEW_NOTE_HOTKEY, 'N');

  function renderMain() {
    if (!is_draft && !selected_id) {
      return (
        <EmptyPanel
          title="Select a note, or start a new one."
          actions={
            <button type="button" className="btn btn-outline" onClick={startDraft}>
              <Icon name="plus" size={14} />
              New note <kbd className="kbd">{new_note_label}</kbd>
            </button>
          }
        />
      );
    }
    if (selected_id && current.error) {
      return <EmptyPanel icon="notes" title="Note not found">{current.error}</EmptyPanel>;
    }
    if (!is_draft && !editor_note) {
      return <div className="editor-loading" aria-busy="true"><span className="dots"><i /><i /><i /></span></div>;
    }
    return (
      <NoteEditor
        key={editor_key}
        note={editor_note}
        folders_by_id={folders_by_id}
        folder_tree={folder_tree}
        chunk_id={chunk_id}
        return_link={return_link}
        list_collapsed={list_collapsed}
        outline_request={outline_request}
        chat_open={chat_open}
        flush_ref={flush_ref}
        onToggleList={() => set_list_collapsed((c) => !c)}
        onToggleChat={() => set_chat_open((open) => !open)}
        onCreate={handleCreate}
        onSaved={handleSaved}
        onOrganize={(patch) => editor_note && void organizeNote(editor_note, patch)}
        onDelete={() => editor_note && set_note_to_delete(editor_note)}
        onDismissCitation={dismissCitation}
        onBack={() => navigate(AppRoutes.notes(filter_search))}
        onOpenChat={() => set_sheet_tab('chat')}
        onOpenDetails={() => set_sheet_tab('details')}
      />
    );
  }

  const context_label = NoteFilterParams.contextLabel(filters, folders_by_id);
  const show_detail = is_draft || !!selected_id;

  const rail = (variant: 'rail' | 'drawer', onClose?: () => void) => (
    <AppRail
      variant={variant}
      onClose={onClose}
      action={{ label: 'New note', icon: 'plus', shortcut_label: new_note_label, onClick: startDraft }}
    >
      {(collapsed) => (
        <NotesRailSections
          collapsed={collapsed}
          folders={folders}
          tags={tags}
          filters={filters}
          onSelect={selectFilters}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={requestFolderDelete}
        />
      )}
    </AppRail>
  );

  const list_pane = (
    <NotesList
      label={context_label}
      list={list}
      filters={filters}
      selected_id={selected_id}
      search_ref={search_ref}
      folder_tree={folder_tree}
      onSelect={openNote}
      onOrganizeNote={(note, patch) => void organizeNote(note, patch)}
      onDeleteNote={set_note_to_delete}
      selection={selection}
      bulk_busy={bulk_busy}
      onBulkAction={(action, notes) => void runBulk(action, notes)}
      onBulkDelete={set_notes_to_bulk_delete}
      onQueryChange={(q) => replaceFilters({ ...filters, q })}
      onSortChange={(sort) => replaceFilters({ ...filters, sort })}
      onClearFilters={() => selectFilters({ folder: null, archived: false, tag: null, q: '' })}
    />
  );

  const dialogs = (
    <>
      <ConfirmDialog
        open={!!notes_to_bulk_delete}
        title={`Delete ${Plural.count(notes_to_bulk_delete?.length ?? 0, 'note')}?`}
        confirm_label={`Delete ${Plural.count(notes_to_bulk_delete?.length ?? 0, 'note')}`}
        danger
        busy={bulk_busy}
        onConfirm={() => void confirmBulkDelete()}
        onCancel={() => set_notes_to_bulk_delete(null)}
      >
        <p>They're removed from your notes and from search, and can't be restored from Cortex.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!note_to_delete}
        title={`Delete “${note_to_delete?.title ?? ''}”?`}
        confirm_label="Delete note"
        danger
        busy={dialog_busy}
        onConfirm={() => void confirmDeleteNote()}
        onCancel={() => set_note_to_delete(null)}
      >
        <p>It's removed from your notes and from search, and can't be restored from Cortex.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!folder_to_delete}
        title={`Delete “${folder_to_delete?.folder.name ?? ''}” and everything in it?`}
        confirm_label="Delete folder and notes"
        danger
        busy={dialog_busy}
        onConfirm={() => void confirmDeleteFolder()}
        onCancel={() => set_folder_to_delete(null)}
      >
        {folder_to_delete && (
          <>
            <p>
              This deletes <strong>{folder_to_delete.folder.name}</strong>
              {folder_to_delete.subfolder_count > 0 && <>, its {Plural.count(folder_to_delete.subfolder_count, 'subfolder')}</>}
              {' '}and <strong>{Plural.count(folder_to_delete.note_count, 'note')}</strong> filed inside
              {folder_to_delete.subfolder_count > 0 ? ' them' : ' it'}. Archived notes in {folder_to_delete.subfolder_count > 0 ? 'these folders' : 'this folder'} are deleted too.
            </p>
            <p className="dialog-warning">
              <Icon name="trash" size={14} />
              Deleted notes can't be restored from Cortex.
            </p>
          </>
        )}
      </ConfirmDialog>
    </>
  );

  if (is_mobile) {
    return (
      <MobileShell
        rail={(close) => rail('drawer', close)}
        show_tabs={!show_detail}
        fab={
          <RadialFab
            label="New note"
            default_key="note"
            actions={[
              { key: 'note', label: 'New note', icon: 'file_plus', onSelect: startDraft },
              { key: 'chat', label: 'New chat', icon: 'sparkle', onSelect: () => navigate(AppRoutes.chat({ conversation_id: AppRoutes.NEW_THREAD_SEGMENT })) },
              { key: 'voice', label: 'Voice chat', icon: 'mic', onSelect: () => navigate(AppRoutes.chat({ conversation_id: AppRoutes.NEW_THREAD_SEGMENT, mode: 'voice' })) },
            ]}
          />
        }
      >
        {(openDrawer) => (
          <div className="m-body" ref={chrome.ref}>
            {show_detail ? (
              <>
                {renderMain()}
                {editor_note && (
                  <BottomSheet
                    open={!!sheet_tab}
                    title={sheet_tab === 'chat' ? 'Chat about this note' : 'Note details'}
                    size="tall"
                    onClose={() => set_sheet_tab(null)}
                  >
                    <NoteRightRail
                      note={editor_note}
                      folders_by_id={folders_by_id}
                      related={related}
                      tab={sheet_tab ?? 'details'}
                      onTabChange={set_sheet_tab}
                      flush={flushEditor}
                      onOutline={(line) => {
                        // The sheet covers the editor, so it has to be out of the way first.
                        set_sheet_tab(null);
                        set_outline_request((prev) => ({ line, nonce: (prev?.nonce ?? 0) + 1 }));
                      }}
                      onOpenNote={(id) => {
                        set_sheet_tab(null);
                        openNote(id);
                      }}
                    />
                  </BottomSheet>
                )}
              </>
            ) : (
              <>
                <div className="m-chrome" data-collapsed={chrome.collapsed}>
                  <div className="m-chrome-inner">
                    <MobileBar>
                      <MobileBarButton label="Menu" icon="menu" onClick={openDrawer} />
                      <MobileBarTitle
                        title={context_label}
                        subtitle={Plural.count(list.count, 'note')}
                        onPress={() => set_folder_sheet_open(true)}
                      />
                      <ThemeToggleButton />
                    </MobileBar>
                    <VerifyBanner />
                  </div>
                </div>
                {list_pane}
                <MobileFolderSheet
                  open={folder_sheet_open}
                  filters={filters}
                  folder_tree={folder_tree}
                  onSelect={selectFilters}
                  onClose={() => set_folder_sheet_open(false)}
                />
              </>
            )}
            {dialogs}
          </div>
        )}
      </MobileShell>
    );
  }

  return (
    <div className="workspace">
      {rail('rail')}

      {!list_collapsed && list_pane}

      <div className="workspace-main">
        <VerifyBanner />
        {renderMain()}
      </div>

      {editor_note && (
        <NoteRightRail
          note={editor_note}
          folders_by_id={folders_by_id}
          related={related}
          tab={chat_open ? 'chat' : 'details'}
          onTabChange={(tab: NoteRailTab) => set_chat_open(tab === 'chat')}
          flush={flushEditor}
          onOutline={(line) => set_outline_request((prev) => ({ line, nonce: (prev?.nonce ?? 0) + 1 }))}
          onOpenNote={openNote}
        />
      )}

      {dialogs}
    </div>
  );
}
