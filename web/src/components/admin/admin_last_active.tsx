import { DateFormat } from '../../lib/date_format';

export function AdminLastActive({ at }: { at?: string }) {
  if (!at) return <span className="admin-muted">Never</span>;
  return (
    <time className="mono-meta" dateTime={at} title={DateFormat.full(at)}>
      {DateFormat.relative(at)}
    </time>
  );
}
