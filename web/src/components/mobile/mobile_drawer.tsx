import type { ReactNode } from 'react';
import { useSheetDialog } from '../../lib/use_sheet_dialog';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

/** The workspace rail as a slide-over. Native <dialog>, so focus trapping and Esc are free. */
export function MobileDrawer({ open, onClose, children }: Props) {
  const { ref, shown } = useSheetDialog(open);

  return (
    <dialog
      ref={ref}
      className={`m-drawer${shown ? ' m-drawer-shown' : ''}`}
      aria-label="Menu"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // The dialog fills the viewport, so a click that lands on it rather than the panel is
      // a click on the scrim.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="m-drawer-panel">{children}</div>
    </dialog>
  );
}
