import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useSheetDialog } from '../../lib/use_sheet_dialog';
import { SheetDrag } from '../../lib/sheet_drag';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/** A bottom sheet on a native <dialog>, draggable down to dismiss by its header. */
export function BottomSheet({ open, title, onClose, children }: Props) {
  const { ref, shown } = useSheetDialog(open);
  const [drag_offset, set_drag_offset] = useState(0);
  const drag_start = useRef<{ y: number; at: number } | null>(null);

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    drag_start.current = { y: event.clientY, at: performance.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag_start.current;
    if (!start) return;
    set_drag_offset(SheetDrag.offsetFor(event.clientY - start.y));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag_start.current;
    drag_start.current = null;
    set_drag_offset(0);
    if (!start) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const release = { distance_px: event.clientY - start.y, elapsed_ms: performance.now() - start.at };
    if (SheetDrag.shouldDismiss(release)) onClose();
  }

  return (
    <dialog
      ref={ref}
      className={`m-sheet${shown ? ' m-sheet-shown' : ''}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="m-sheet-panel"
        style={drag_offset ? { transform: `translateY(${drag_offset}px)`, transition: 'none' } : undefined}
      >
        <div
          className="m-sheet-grip"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="m-sheet-handle" aria-hidden="true" />
          <span className="m-sheet-title">{title}</span>
          <button type="button" className="m-sheet-close" onClick={onClose} aria-label="Close">
            Done
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </dialog>
  );
}
