import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, RefObject } from 'react';
import type { Note, NoteBulkAction, NotePatchBody } from '../../lib/note.types';
import { DateFormat } from '../../lib/date_format';
import { NotePreview } from '../../lib/note_preview';
import { Icon } from '../icon';
import type { FolderTreeNode, NoteFilters, NoteSortMode } from '../../lib/note_workspace.types';
import type { NoteList } from '../../lib/use_note_list';
import type { NoteSelection } from '../../lib/use_note_selection';
import { Hotkey } from '../../lib/hotkey';
import { NoteOutline } from '../../lib/note_outline';
import { useIsMobile } from '../../lib/use_is_mobile';
import { useLongPress } from '../../lib/use_long_press';
import { NoteRowMenu } from './note_row_menu';
import { NotesBulkBar } from './notes_bulk_bar';

const SEARCH_DEBOUNCE_MS = 250;
const MAX_ROW_TAGS = 3;
const SKELETON_ROWS = 4;
/** Starts the next page a little before the sentinel is actually on screen. */
const LOAD_MORE_ROOT_MARGIN = '240px';

type Props = {
  label: string;
  list: NoteList;
  filters: NoteFilters;
  selected_id: string | null;
  search_ref: RefObject<HTMLInputElement>;
  folder_tree: FolderTreeNode[];
  onSelect: (note_id: string) => void;
  onOrganizeNote: (note: Note, patch: NotePatchBody) => void;
  onDeleteNote: (note: Note) => void;
  selection: NoteSelection;
  bulk_busy: boolean;
  onBulkAction: (action: NoteBulkAction, notes: Note[]) => void;
  onBulkDelete: (notes: Note[]) => void;
  onQueryChange: (q: string) => void;
  onSortChange: (sort: NoteSortMode) => void;
  onClearFilters: () => void;
};

export function NotesList(props: Props) {
  const { label, list, filters, selected_id, search_ref, onQueryChange, onSortChange, onClearFilters } = props;
  const is_mobile = useIsMobile();
  const [query, set_query] = useState(filters.q);
  const scroll_ref = useRef<HTMLDivElement>(null);
  const sentinel_ref = useRef<HTMLDivElement>(null);
  const on_query_ref = useRef(onQueryChange);
  on_query_ref.current = onQueryChange;

  // Follow the URL when it changes from outside (back button, clearing filters).
  useEffect(() => {
    set_query(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (query === filters.q) return;
    const timer = window.setTimeout(() => on_query_ref.current(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, filters.q]);

  const { has_more, loadMore } = list;
  useEffect(() => {
    const sentinel = sentinel_ref.current;
    if (!sentinel || !has_more) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: scroll_ref.current, rootMargin: LOAD_MORE_ROOT_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [has_more, loadMore]);

  const count = list.count;
  const is_filtered = !!(filters.q || filters.tag || filters.folder || filters.archived);
  const is_initial_load = list.loading && list.pinned.length === 0 && list.items.length === 0;

  const { selection } = props;
  const ordered = [...list.pinned, ...list.items];
  const ordered_ids = ordered.map((n) => n.id);
  // Only loaded rows count, so a note that left the list after a refresh drops out of the selection.
  const selected_notes = ordered.filter((n) => selection.has(n.id));
  const all_selected = ordered.length > 0 && selected_notes.length === ordered.length;

  function handleRowClick(note: Note, event: MouseEvent) {
    if (event.shiftKey) return selection.extendTo(note.id, ordered_ids, selected_id);
    if (selection.active || event.metaKey || event.ctrlKey) return selection.toggle(note.id);
    props.onSelect(note.id);
  }

  function renderRows(notes: Note[]) {
    return notes.map((note) => (
      <NoteRow
        key={note.id}
        note={note}
        active={note.id === selected_id}
        selecting={selection.active}
        checked={selection.has(note.id)}
        folder_tree={props.folder_tree}
        onClick={handleRowClick}
        onOrganize={props.onOrganizeNote}
        onDelete={props.onDeleteNote}
        onStartSelection={(n) => selection.start(n.id)}
      />
    ));
  }

  function renderBody() {
    if (is_initial_load) {
      return Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className="list-row list-row-skeleton" aria-hidden="true">
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line skeleton-line-short" />
        </div>
      ));
    }
    if (list.error && count === 0) {
      return <p className="list-empty list-empty-error" role="alert">{list.error}</p>;
    }
    if (count === 0) {
      return (
        <div className="list-empty">
          <p>{is_filtered ? 'No notes match.' : 'No notes yet.'}</p>
          {is_filtered && (
            <button type="button" className="link-btn" onClick={onClearFilters}>Clear filters</button>
          )}
        </div>
      );
    }
    return (
      <>
        {list.pinned.length > 0 && (
          <>
            <div className="list-group-label">Pinned</div>
            {renderRows(list.pinned)}
            {list.items.length > 0 && <div className="list-group-label">Notes</div>}
          </>
        )}
        {renderRows(list.items)}
        {list.has_more && (
          <div ref={sentinel_ref} className="list-sentinel">
            {list.loading_more && <span className="dots" aria-label="Loading more notes"><i /><i /><i /></span>}
          </div>
        )}
      </>
    );
  }

  return (
    <section className="list-pane" aria-label="Notes">
      <div className="list-search">
        <Icon name="search" size={14} className="list-search-icon" />
        <input
          ref={search_ref}
          type="search"
          value={query}
          onChange={(e) => set_query(e.target.value)}
          placeholder="Search notes…"
          aria-label="Search notes"
          className="input input-search"
        />
        <kbd className="kbd list-search-kbd">{Hotkey.label({ mod: true }, 'K')}</kbd>
      </div>

      {selection.active ? (
        <div className="list-header list-header-selecting">
          <label className="bulk-select-all" title={list.has_more ? 'Selects the notes loaded so far' : undefined}>
            <input
              type="checkbox"
              className="bulk-check"
              checked={all_selected}
              ref={(el) => {
                if (el) el.indeterminate = selected_notes.length > 0 && !all_selected;
              }}
              onChange={() => selection.setAll(all_selected ? [] : ordered_ids)}
              aria-label={all_selected ? 'Clear selection' : 'Select all loaded notes'}
              disabled={ordered.length === 0}
            />
            <span className="list-label" aria-live="polite">{selected_notes.length} selected</span>
          </label>
          <button type="button" className="sort-btn" onClick={selection.exit}>Done</button>
        </div>
      ) : (
        <div className="list-header">
          <div className="list-header-title">
            <span className="list-label">{label}</span>
            {!is_initial_load && <span className="mono-count">{count}</span>}
          </div>
          <div className="list-header-actions">
            {/* Touch enters selection with a long press, so the button is desktop-only. */}
            {!is_mobile && (
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => selection.start()}
                disabled={ordered.length === 0}
                aria-label="Select notes"
                title="Select notes (⇧-click for a range)"
              >
                <Icon name="check" size={13} />
              </button>
            )}
            <button
              type="button"
              className="sort-btn"
              onClick={() => onSortChange(filters.sort === 'recent' ? 'az' : 'recent')}
              aria-label={`Sorted by ${filters.sort === 'recent' ? 'most recent' : 'title'}. Change sort`}
            >
              {filters.sort === 'recent' ? 'Recent' : 'A–Z'}
              <Icon name="chevron_down" size={11} />
            </button>
          </div>
        </div>
      )}

      <div className={`list-scroll${list.loading && !is_initial_load ? ' list-scroll-refreshing' : ''}`} ref={scroll_ref} aria-busy={list.loading}>
        {renderBody()}
      </div>

      {selection.active && (
        <NotesBulkBar
          notes={selected_notes}
          folder_tree={props.folder_tree}
          busy={props.bulk_busy}
          onAction={(action) => props.onBulkAction(action, selected_notes)}
          onDelete={() => props.onBulkDelete(selected_notes)}
        />
      )}
    </section>
  );
}

type NoteRowProps = {
  note: Note;
  active: boolean;
  selecting: boolean;
  checked: boolean;
  folder_tree: FolderTreeNode[];
  onClick: (note: Note, event: MouseEvent) => void;
  onOrganize: (note: Note, patch: NotePatchBody) => void;
  onDelete: (note: Note) => void;
  onStartSelection: (note: Note) => void;
};

function NoteRow({ note, active, selecting, checked, folder_tree, onClick, onOrganize, onDelete, onStartSelection }: NoteRowProps) {
  const preview = NoteOutline.plainExcerpt(NotePreview.excerpt(note));
  // A hold still produces a click; without this the row would immediately deselect itself.
  const suppress_click = useRef(false);
  const long_press = useLongPress(() => {
    suppress_click.current = true;
    onStartSelection(note);
  }, !selecting);
  const row_class = ['list-row', 'note-row', active && 'list-row-active', selecting && 'note-row-selecting', checked && 'note-row-checked']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={row_class}>
      <button
        type="button"
        className="note-row-select"
        aria-current={active && !selecting ? 'true' : undefined}
        aria-pressed={selecting ? checked : undefined}
        {...long_press}
        onClick={(e) => {
          if (suppress_click.current) {
            suppress_click.current = false;
            return;
          }
          onClick(note, e);
        }}
      >
        {selecting && <input type="checkbox" className="bulk-check note-row-check" checked={checked} readOnly tabIndex={-1} aria-hidden="true" />}
        <span className="list-row-top">
          {note.is_pinned && <Icon name="pin" size={11} className="list-row-pin" />}
          <span className="list-row-title">{note.title || 'Untitled'}</span>
          <time className="list-row-time" dateTime={note.updated_at} title={DateFormat.full(note.updated_at)}>
            {DateFormat.relative(note.updated_at)}
          </time>
        </span>
        <span className="list-row-preview">{preview || <em>Empty note</em>}</span>
        {note.tags.length > 0 && (
          <span className="list-row-tags">
            {note.tags.slice(0, MAX_ROW_TAGS).map((tag) => (
              <span key={tag} className="chip">{tag}</span>
            ))}
          </span>
        )}
      </button>
      {!selecting && (
        <span className="note-row-actions">
          <NoteRowMenu note={note} folder_tree={folder_tree} onOrganize={onOrganize} onDelete={onDelete} onStartSelection={onStartSelection} />
        </span>
      )}
    </div>
  );
}
