export function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy} aria-busy={busy}>
      {busy ? (
        <>
          <span className="spin-ring" aria-hidden="true" />
          Working…
        </>
      ) : (
        label
      )}
    </button>
  );
}
