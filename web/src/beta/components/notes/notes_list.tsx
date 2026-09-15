import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Note, NotePatchBody } from '../../../lib/note.types';
import { DateFormat } from '../../../lib/date_format';
import { NotePreview } from '../../../lib/note_preview';
import { Icon } from '../../../components/icon';
import type { FolderTreeNode, NoteFilters, NoteSortMode } from '../../lib/note_workspace.types';
import type { NoteList } from '../../lib/use_note_list';
import { Hotkey } from '../../lib/hotkey';
import { NoteOutline } from '../../lib/note_outline';
import { NoteRowMenu } from './note_row_menu';

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
  onQueryChange: (q: string) => void;
  onSortChange: (sort: NoteSortMode) => void;
  onClearFilters: () => void;
};

export function NotesList(props: Props) {
  const { label, list, filters, selected_id, search_ref, onQueryChange, onSortChange, onClearFilters } = props;
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

  const count = list.pinned.length + list.total;
  const is_filtered = !!(filters.q || filters.tag || filters.folder || filters.archived);
  const is_initial_load = list.loading && list.pinned.length === 0 && list.items.length === 0;

  function renderRows(notes: Note[]) {
    return notes.map((note) => (
      <NoteRow
        key={note.id}
        note={note}
        active={note.id === selected_id}
        folder_tree={props.folder_tree}
        onSelect={props.onSelect}
        onOrganize={props.onOrganizeNote}
        onDelete={props.onDeleteNote}
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

      <div className="list-header">
        <div className="list-header-title">
          <span className="list-label">{label}</span>
          {!is_initial_load && <span className="mono-count">{count}</span>}
        </div>
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

      <div className={`list-scroll${list.loading && !is_initial_load ? ' list-scroll-refreshing' : ''}`} ref={scroll_ref} aria-busy={list.loading}>
        {renderBody()}
      </div>
    </section>
  );
}

type NoteRowProps = {
  note: Note;
  active: boolean;
  folder_tree: FolderTreeNode[];
  onSelect: (id: string) => void;
  onOrganize: (note: Note, patch: NotePatchBody) => void;
  onDelete: (note: Note) => void;
};

function NoteRow({ note, active, folder_tree, onSelect, onOrganize, onDelete }: NoteRowProps) {
  const preview = NoteOutline.plainExcerpt(NotePreview.excerpt(note));
  return (
    <div className={`list-row note-row${active ? ' list-row-active' : ''}`}>
      <button type="button" className="note-row-select" aria-current={active ? 'true' : undefined} onClick={() => onSelect(note.id)}>
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
      <span className="note-row-actions">
        <NoteRowMenu note={note} folder_tree={folder_tree} onOrganize={onOrganize} onDelete={onDelete} />
      </span>
    </div>
  );
}
