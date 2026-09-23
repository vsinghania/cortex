import { MobileBar, MobileBarButton, MobileBarTitle } from '../mobile/mobile_bar';

type Props = {
  title: string;
  thinking: boolean;
  onBack: () => void;
  onOpenInfo: () => void;
};

export function MobileThreadBar({ title, thinking, onBack, onOpenInfo }: Props) {
  return (
    <MobileBar>
      <MobileBarButton label="Back to threads" icon="back" onClick={onBack} accent />
      <MobileBarTitle title={title} subtitle={thinking ? 'thinking…' : 'cortex-1'} />
      <MobileBarButton label="Session details" icon="info" onClick={onOpenInfo} />
    </MobileBar>
  );
}
