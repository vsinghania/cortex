import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirm_label: string;
  danger?: boolean;
  busy?: boolean;
  confirm_autofocus?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A native modal <dialog>, so focus trapping and Esc come from the browser. */
export function ConfirmDialog({ open, title, children, confirm_label, danger = false, busy = false, confirm_autofocus = true, onConfirm, onCancel }: Props) {
  const dialog_ref = useRef<HTMLDialogElement>(null);
  const title_id = useId();

  useEffect(() => {
    const dialog = dialog_ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialog_ref}
      className="confirm-dialog"
      aria-labelledby={title_id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={title_id} className="confirm-dialog-title">{title}</h2>
      <div className="confirm-dialog-body">{children}</div>
      <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={onConfirm}
          disabled={busy}
          autoFocus={confirm_autofocus && !danger}
        >
          {busy ? 'Working…' : confirm_label}
        </button>
      </div>
    </dialog>
  );
}
