import { Icon } from '../icon';
import type { AssistantMode } from '../../lib/app_routes';

type Props = {
  title: string;
  thinking: boolean;
  mode: AssistantMode;
  list_collapsed: boolean;
  onToggleList: () => void;
  onModeChange: (mode: AssistantMode) => void;
};

export function AssistantHeader({ title, thinking, mode, list_collapsed, onToggleList, onModeChange }: Props) {
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
      <div className="segmented segmented-lg" role="radiogroup" aria-label="Assistant mode">
        {(['chat', 'voice'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            className={`segmented-item${mode === value ? ' segmented-item-active' : ''}`}
            onClick={() => onModeChange(value)}
          >
            <Icon name={value === 'chat' ? 'chat' : 'mic'} size={13} className="segmented-icon" />
            {value === 'chat' ? 'Chat' : 'Voice'}
          </button>
        ))}
      </div>
    </header>
  );
}
