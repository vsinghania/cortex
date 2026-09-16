const OPEN_MS = 14;
const HOVER_MS = 8;
const COMMIT_MS = 16;

/** Wraps `navigator.vibrate`, which is unsupported on iOS and throws behind some policies. */
export class Haptics {
  private static buzz(duration_ms: number): void {
    try {
      navigator.vibrate?.(duration_ms);
    } catch {
      // Haptics are decorative; a refusal is never worth surfacing.
    }
  }

  static open(): void {
    Haptics.buzz(OPEN_MS);
  }

  static hover(): void {
    Haptics.buzz(HOVER_MS);
  }

  static commit(): void {
    Haptics.buzz(COMMIT_MS);
  }
}
