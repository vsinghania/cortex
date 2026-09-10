import type { NoteTagCount } from '../lib/note.types';

type Props = {
  tags: NoteTagCount[];
  active_tags: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
};

export function TagFilterBar({ tags, active_tags, onToggle, onClear }: Props) {
  if (tags.length === 0) return null;

  const isActive = (tag: string) => active_tags.some((a) => a.toLowerCase() === tag.toLowerCase());

  return (
    <div className="tag-filter-bar">
      <div className="tag-filter-chips">
        {tags.map(({ tag, count }) => (
          <button
            key={tag}
            type="button"
            className={`tag-chip${isActive(tag) ? ' tag-chip-active' : ''}`}
            aria-pressed={isActive(tag)}
            onClick={() => onToggle(tag)}
          >
            {tag}
            <span className="tag-chip-count">{count}</span>
          </button>
        ))}
      </div>
      {active_tags.length > 0 && (
        <button type="button" className="tag-filter-clear" onClick={onClear}>
          Clear {active_tags.length === 1 ? 'filter' : `${active_tags.length} filters`}
        </button>
      )}
    </div>
  );
}
