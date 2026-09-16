/** Distance from the button's centre to each option's centre. */
const RADIUS_PX = 96;
/** Angle between adjacent options, fanned symmetrically about straight up. */
const ARC_DEGREES = 62;
/** Inside this the pointer is "on the button", not on any option. */
const DEAD_ZONE_PX = 30;
/** Slack past half an arc, so the gaps between options aren't dead. */
const SELECT_SLACK_DEGREES = 8;
/** A press that drifts less than this is a tap, not a drag. */
const TAP_DRIFT_PX = 14;
const STRAIGHT_UP_DEGREES = -90;

export type RadialPoint = { x: number; y: number };

/** Geometry for the compose button's long-press menu; no DOM, so it stays testable. */
export class RadialMenu {
  static angleOf(index: number, count: number): number {
    return STRAIGHT_UP_DEGREES + (index - (count - 1) / 2) * ARC_DEGREES;
  }

  static offsetOf(index: number, count: number): RadialPoint {
    const radians = (RadialMenu.angleOf(index, count) * Math.PI) / 180;
    return { x: Math.cos(radians) * RADIUS_PX, y: Math.sin(radians) * RADIUS_PX };
  }

  /** The option the pointer is aimed at, or -1 for none. */
  static optionAt(dx: number, dy: number, count: number): number {
    if (Math.hypot(dx, dy) < DEAD_ZONE_PX) return -1;
    const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
    let best = -1;
    let best_difference = Number.POSITIVE_INFINITY;
    for (let index = 0; index < count; index += 1) {
      const difference = Math.abs((((degrees - RadialMenu.angleOf(index, count)) % 360) + 540) % 360 - 180);
      if (difference < best_difference) {
        best_difference = difference;
        best = index;
      }
    }
    return best_difference <= ARC_DEGREES / 2 + SELECT_SLACK_DEGREES ? best : -1;
  }

  static isTap(dx: number, dy: number): boolean {
    return Math.hypot(dx, dy) < TAP_DRIFT_PX;
  }
}
