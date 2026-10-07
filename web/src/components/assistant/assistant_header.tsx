import { Icon } from '../icon';

type Props = {
  title: string;
  thinking: boolean;
  list_collapsed: boolean;
  onToggleList: () => void;
};

export function AssistantHeader({ title, thinking, list_collapsed, onToggleList }: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-crumbs">
        <button
          type="button"
          className={`icon-btn${list_collapsed ? ' icon-btn-accent' : ''}`}
          onClick={onToggleList}
          aria-label={list_collapsed ? 'Show thread list' : 'Hide thread list'}
          title={list_collapsed ? 'Show thread list' : 'Hide thread list'}
        >
          <Icon name="panel" size={15} />
        </button>
        <span className="crumb-muted">Assistant</span>
        <Icon name="chevron_right" size={12} className="crumb-sep" />
        <span className="crumb-current">{title}</span>
        {thinking && (
          <span className="thinking" role="status">
            <span className="spin-ring spin-ring-sm" aria-hidden="true" />
            thinking
          </span>
        )}
      </div>
    </header>
  );
}
