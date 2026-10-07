import { Icon } from './icon';

type Props = {
  size?: 'sm' | 'lg';
  mark_only?: boolean;
};

export function BrandWordmark({ size = 'sm', mark_only = false }: Props) {
  return (
    <span className={`wordmark wordmark-${size}`}>
      <Icon name="hexagon" className="wordmark-mark" size={size === 'lg' ? 24 : 17} />
      {mark_only ? (
        <span className="sr-only">Cortex beta</span>
      ) : (
        <span className="wordmark-text">
          cortex<span className="wordmark-accent">beta</span>
        </span>
      )}
    </span>
  );
}
