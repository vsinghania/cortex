const DISMISS_DISTANCE_PX = 90;
/** A flick counts even when short, so a quick downward swipe still closes the sheet. */
const DISMISS_VELOCITY_PX_PER_MS = 0.5;

export type SheetDragRelease = {
  distance_px: number;
  elapsed_ms: number;
};

export class SheetDrag {
  static shouldDismiss({ distance_px, elapsed_ms }: SheetDragRelease): boolean {
    if (distance_px >= DISMISS_DISTANCE_PX) return true;
    return elapsed_ms > 0 && distance_px / elapsed_ms >= DISMISS_VELOCITY_PX_PER_MS;
  }

  /** Upward drags are resisted rather than followed, so the sheet never lifts off its stop. */
  static offsetFor(delta_px: number): number {
    return delta_px > 0 ? delta_px : delta_px / 4;
  }
}
