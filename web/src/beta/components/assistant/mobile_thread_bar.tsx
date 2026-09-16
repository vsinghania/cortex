import { Icon } from '../../../components/icon';
import type { AssistantMode } from '../../lib/beta_routes';
import { MobileBar, MobileBarButton, MobileBarTitle } from '../mobile/mobile_bar';

type Props = {
  title: string;
  thinking: boolean;
  mode: AssistantMode;
  onBack: () => void;
  onOpenInfo: () => void;
  onModeChange: (mode: AssistantMode) => void;
};

export function MobileThreadBar({ title, thinking, mode, onBack, onOpenInfo, onModeChange }: Props) {
  return (
    <MobileBar>
      <MobileBarButton label="Back to threads" icon="back" onClick={onBack} accent />
      <MobileBarTitle title={title} subtitle={thinking ? 'thinking…' : 'cortex-1'} />
      <div className="segmented" role="radiogroup" aria-label="Assistant mode">
        {(['chat', 'voice'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            aria-label={value === 'chat' ? 'Chat' : 'Voice'}
            title={value === 'chat' ? 'Chat' : 'Voice'}
            className={`segmented-item${mode === value ? ' segmented-item-active' : ''}`}
            onClick={() => onModeChange(value)}
          >
            <Icon name={value === 'chat' ? 'chat' : 'mic'} size={15} />
          </button>
        ))}
      </div>
      <MobileBarButton label="Session details" icon="info" onClick={onOpenInfo} />
    </MobileBar>
  );
}
