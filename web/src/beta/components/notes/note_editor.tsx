import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Note, NotePatchBody } from '../../../lib/note.types';
import type { NoteFolderNode } from '../../../lib/note_folder.types';
import type { ReturnLinkState } from '../../../lib/navigation.types';
import { DateFormat } from '../../../lib/date_format';
import type { FolderTreeNode, NoteDraftFields, OutlineRequest } from '../../lib/note_workspace.types';
import { useNoteAutosave } from '../../lib/use_note_autosave';
import { useFilingSuggestion } from '../../lib/use_filing_suggestion';
import { NoteFiling } from '../../lib/note_filing';
import type { FilingChoice } from '../../lib/note_filing';
import { useNowTick } from '../../lib/use_now_tick';
import { useIsMobile } from '../../lib/use_is_mobile';
import { NoteOutline } from '../../lib/note_outline';
import { MarkdownPreview } from '../markdown_preview';
import { NoteToolbar } from './note_toolbar';
import { MobileNoteBar } from './mobile_note_bar';
import { TagEditor } from './tag_editor';
import { CitationSourceView } from './citation_source_view';
import { FilingSuggestionCard } from './filing_suggestion_card';
import type { EditorMode } from './note_mode_switch';

const RELATIVE_TIME_TICK_MS = 30_000;
/** Keeps the heading a scroll jump lands on from sitting flush against the toolbar. */
const OUTLINE_SCROLL_OFFSET_PX = 24;
export const UNTITLED_NOTE_TITLE = 'Untitled note';

type Props = {
  /** Null while this is an unsaved draft. */
  note: Note | null;
  folders_by_id: Map<string, NoteFolderNode>;
  folder_tree: FolderTreeNode[];
  chunk_id: string | null;
  return_link: ReturnLinkState | null;
  list_collapsed: boolean;
  outline_request: OutlineRequest | null;
  chat_open: boolean;
  /** Receives this editor's autosave flush, so the note chat can save pending edits before asking. */
  flush_ref: MutableRefObject<(() => Promise<void>) | null>;
  onToggleList: () => void;
  onToggleChat: () => void;
  /** Mobile only: the detail screen replaces the toolbar with a back-and-details bar. */
  onBack?: () => void;
  onOpenInfo?: () => void;
  onCreate: (fields: NoteDraftFields) => Promise<Note>;
  onSaved: (note: Note) => void;
  onOrganize: (patch: NotePatchBody) => void;
  onDelete: () => void;
  onDismissCitation: () => void;
};

/**
 * Owns the title and body while open and never re-reads them from props, so a save
 * response or a list refresh can't yank text out from under the cursor. The page keys
 * this component by note, which is what resets it.
 */
export function NoteEditor(props: Props) {
  const { note, chunk_id } = props;
  const is_mobile = useIsMobile();
  const [title, set_title] = useState(note?.title === UNTITLED_NOTE_TITLE ? '' : note?.title ?? '');
  const [body, set_body] = useState(note?.body ?? '');
  const [mode, set_mode] = useState<EditorMode>('edit');
  const [create_error, set_create_error] = useState<string | null>(null);
  const title_value_ref = useRef(title);
  const body_value_ref = useRef(body);
  const creating_ref = useRef(false);
  // After a failed create, typing must not fire a request per keystroke; "Try again" retries.
  const create_failed_ref = useRef(false);
  const title_el_ref = useRef<HTMLTextAreaElement>(null);
  const body_el_ref = useRef<HTMLTextAreaElement>(null);
  const scroll_ref = useRef<HTMLDivElement>(null);
  const autosave = useNoteAutosave({ note_id: note?.id ?? null, onSaved: props.onSaved });
  const filing = useFilingSuggestion();
  // Tag adds build on the last tags sent, so a second click doesn't overwrite a first still in flight.
  const tags_basis_ref = useRef(note?.tags ?? []);
  const [filing_applied, set_filing_applied] = useState(false);
  useNowTick(RELATIVE_TIME_TICK_MS);

  const { flush_ref } = props;
  useEffect(() => {
    const flush = autosave.flush;
    flush_ref.current = flush;
    return () => {
      if (flush_ref.current === flush) flush_ref.current = null;
    };
  }, [flush_ref, autosave.flush]);

  // Every save returns a fresh tags array; only a real change should reset the basis.
  const note_tags_key = JSON.stringify(note?.tags ?? []);
  useEffect(() => {
    tags_basis_ref.current = JSON.parse(note_tags_key) as string[];
  }, [note_tags_key]);

  useLayoutEffect(() => {
    GrowingTextarea.fit(title_el_ref.current);
  }, [title]);
  useLayoutEffect(() => {
    GrowingTextarea.fit(body_el_ref.current);
  }, [body, mode, chunk_id]);

  // A brand-new draft starts with the cursor in the title.
  useEffect(() => {
    if (!note) title_el_ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (props.outline_request) scrollToLine(props.outline_request.line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.outline_request]);

  function scrollToLine(line: number) {
    const scroller = scroll_ref.current;
    if (!scroller) return;
    if (mode === 'preview' || chunk_id) {
      scroller.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const textarea = body_el_ref.current;
    if (!textarea) return;
    const offset = NoteOutline.lineStartOffset(body_value_ref.current, line);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(offset, offset);
    // The textarea grows to fit, so the page scrolls rather than the textarea; the line's
    // share of the text is a close enough estimate of where it sits.
    const fraction = (line - 1) / NoteOutline.lineCount(body_value_ref.current);
    scroller.scrollTo({ top: textarea.offsetTop + fraction * textarea.scrollHeight - OUTLINE_SCROLL_OFFSET_PX, behavior: 'smooth' });
  }

  function handleTitleChange(value: string) {
    set_title(value);
    title_value_ref.current = value;
    if (!note) return void createFromDraft({ retry: false });
    // The server requires a title; a cleared one keeps its last saved value until retyped.
    if (value.trim()) autosave.schedule({ title: value.trim() });
  }

  function handleBodyChange(value: string) {
    set_body(value);
    body_value_ref.current = value;
    if (!note) return void createFromDraft({ retry: false });
    autosave.schedule({ body: value });
  }

  /** The first keystroke that gives a draft content creates it; later keystrokes queue behind the create. */
  async function createFromDraft({ retry }: { retry: boolean }) {
    if (creating_ref.current || (create_failed_ref.current && !retry)) return;
    const draft_title = title_value_ref.current.trim();
    const draft_body = body_value_ref.current;
    if (!draft_title && !draft_body.trim()) return;

    creating_ref.current = true;
    create_failed_ref.current = false;
    set_create_error(null);
    try {
      const created = await props.onCreate({ title: draft_title || UNTITLED_NOTE_TITLE, body: draft_body });
      const catch_up: NotePatchBody = {};
      const latest_title = title_value_ref.current.trim();
      if (latest_title && latest_title !== created.title) catch_up.title = latest_title;
      if (body_value_ref.current !== created.body) catch_up.body = body_value_ref.current;
      if (Object.keys(catch_up).length > 0) autosave.schedule(catch_up);
    } catch (err) {
      creating_ref.current = false;
      create_failed_ref.current = true;
      set_create_error(err instanceof Error ? err.message : "Couldn't create the note.");
    }
  }

  function requestFiling() {
    set_filing_applied(false);
    filing.request({ title: title_value_ref.current.trim() || undefined, body: body_value_ref.current });
  }

  function applyFiling(choice: FilingChoice) {
    set_filing_applied(true);
    if (choice.title) handleTitleChange(choice.title);
    const patch: NotePatchBody = {};
    if (choice.folder_id) patch.folder_id = choice.folder_id;
    if (choice.tags) {
      patch.tags = NoteFiling.withTags(tags_basis_ref.current, choice.tags);
      tags_basis_ref.current = patch.tags;
    }
    if (Object.keys(patch).length > 0) props.onOrganize(patch);
  }

  const word_count = NoteOutline.wordCount(body);
  const pending_filing = note && filing.state.status === 'ready'
    ? NoteFiling.pending(filing.state.suggestion, { title, folder_id: note.folder_id, tags: note.tags }, props.folders_by_id)
    : null;
  const filing_done = filing_applied && !!pending_filing && NoteFiling.isEmpty(pending_filing);
  // The citation view is read-only, so there is nothing to suggest a filing for.
  const suggest_control = chunk_id ? null : {
    disabled: !title.trim() && !body.trim(),
    busy: filing.state.status === 'loading',
    onRequest: requestFiling,
  };

  // Once the user has applied everything on offer the card has nothing left to say.
  const { dismiss: dismissFiling } = filing;
  useEffect(() => {
    if (filing_done) dismissFiling();
  }, [filing_done, dismissFiling]);

  return (
    <main className="editor" aria-label="Note editor">
      {is_mobile ? (
        <MobileNoteBar
          note={note}
          title={title}
          folders_by_id={props.folders_by_id}
          folder_tree={props.folder_tree}
          mode={mode}
          show_mode={!chunk_id}
          suggest={suggest_control}
          onBack={props.onBack ?? (() => void 0)}
          onOpenInfo={props.onOpenInfo ?? (() => void 0)}
          onModeChange={set_mode}
          onOrganize={props.onOrganize}
          onDelete={props.onDelete}
        />
      ) : (
        <NoteToolbar
          note={note}
          title={title}
          folders_by_id={props.folders_by_id}
          folder_tree={props.folder_tree}
          mode={mode}
          show_mode={!chunk_id}
          list_collapsed={props.list_collapsed}
          chat_open={props.chat_open}
          onToggleList={props.onToggleList}
          onToggleChat={props.onToggleChat}
          onModeChange={set_mode}
          suggest={suggest_control}
          onOrganize={props.onOrganize}
          onDelete={props.onDelete}
        />
      )}

      <div className="editor-scroll" ref={scroll_ref}>
        <div className="editor-column">
          <textarea
            ref={title_el_ref}
            className={`editor-title${note?.is_archived ? ' editor-title-archived' : ''}`}
            value={title}
            rows={1}
            placeholder={UNTITLED_NOTE_TITLE}
            aria-label="Title"
            spellCheck={false}
            readOnly={!!chunk_id}
            onChange={(e) => handleTitleChange(e.target.value.replace(/\n/g, ' '))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                set_mode('edit');
                body_el_ref.current?.focus();
              }
            }}
          />

          <div className="editor-meta">
            {note && (
              <>
                <time className="mono-meta" dateTime={note.updated_at} title={DateFormat.full(note.updated_at)}>
                  {DateFormat.full(note.updated_at)}
                </time>
                <span className="meta-dot" aria-hidden="true">·</span>
              </>
            )}
            <span className="mono-meta">{word_count} {word_count === 1 ? 'word' : 'words'}</span>
            {note && (
              <>
                <span className="meta-dot" aria-hidden="true">·</span>
                <TagEditor tags={note.tags} onChange={(tags) => props.onOrganize({ tags })} />
              </>
            )}
          </div>

          {note && !chunk_id && filing.state.status !== 'idle' && (
            <FilingSuggestionCard
              state={filing.state}
              pending={pending_filing}
              onApply={applyFiling}
              onRetry={requestFiling}
              onDismiss={filing.dismiss}
            />
          )}

          {create_error && (
            <div className="form-error" role="alert">
              {create_error}{' '}
              <button type="button" className="link-btn" onClick={() => void createFromDraft({ retry: true })}>Try again</button>
            </div>
          )}

          {chunk_id && note ? (
            <CitationSourceView note_id={note.id} body={body} chunk_id={chunk_id} return_link={props.return_link} onEdit={props.onDismissCitation} />
          ) : mode === 'edit' ? (
            <textarea
              ref={body_el_ref}
              className="editor-body"
              value={body}
              placeholder="Start writing… markdown supported."
              aria-label="Note body"
              spellCheck
              onChange={(e) => handleBodyChange(e.target.value)}
              onBlur={() => void autosave.flush()}
            />
          ) : (
            <MarkdownPreview source={body} className="editor-preview" />
          )}
        </div>
      </div>

      <div className="editor-status">
        <AutosaveStatusLine
          note={note}
          status={create_error ? 'error' : autosave.status}
          onRetry={() => void (note ? autosave.flush() : createFromDraft({ retry: true }))}
          is_empty_draft={!note && !title.trim() && !body.trim()}
        />
        <span>markdown</span>
      </div>
    </main>
  );
}

type StatusProps = {
  note: Note | null;
  status: ReturnType<typeof useNoteAutosave>['status'];
  is_empty_draft: boolean;
  onRetry: () => void;
};

function AutosaveStatusLine({ note, status, is_empty_draft, onRetry }: StatusProps) {
  if (status === 'error') {
    return (
      <span className="status-error" role="alert">
        save failed ·{' '}
        <button type="button" className="link-btn" onClick={onRetry}>retry</button>
      </span>
    );
  }
  if (!note) return <span>{is_empty_draft ? 'draft · saves when you start typing' : 'creating…'}</span>;
  if (status === 'saving' || status === 'pending') return <span>saving…</span>;
  if (note.vectorization?.status === 'pending') {
    return <span title="Search and the assistant pick up edits shortly after you stop typing.">saved · indexing for search…</span>;
  }
  return <span>saved · {DateFormat.relative(note.updated_at)}</span>;
}

class GrowingTextarea {
  /** Sizes a textarea to its content so the surrounding pane, not the field, scrolls. */
  static fit(el: HTMLTextAreaElement | null): void {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
}
