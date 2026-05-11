export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner-dot" />
      <span className="spinner-dot" />
      <span className="spinner-dot" />
      {label && <span className="spinner-label">{label}</span>}
    </div>
  );
}
