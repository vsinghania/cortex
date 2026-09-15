import { Platform } from '../../lib/platform';

export type HotkeySpec = {
  /** Matched against KeyboardEvent.key, case-insensitively. */
  key?: string;
  /**
   * Matched against KeyboardEvent.code. Needed when a modifier rewrites `key`
   * (⌥N types "˜" on a Mac, ⇧\\ types "|").
   */
  code?: string;
  /** ⌘ on Apple platforms, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export class Hotkey {
  static matches(event: KeyboardEvent, spec: HotkeySpec): boolean {
    if (!!spec.mod !== (event.metaKey || event.ctrlKey)) return false;
    if (!!spec.shift !== event.shiftKey) return false;
    if (!!spec.alt !== event.altKey) return false;
    if (spec.code) return event.code === spec.code;
    return !!spec.key && event.key.toLowerCase() === spec.key.toLowerCase();
  }

  /** Display form, e.g. "⌘⌥N" or "Ctrl+Alt+N". */
  static label(spec: HotkeySpec, key_label: string): string {
    const mod = Platform.modifierKeyLabel();
    const is_apple = mod === '⌘';
    const parts = [
      spec.mod ? mod : null,
      spec.shift ? (is_apple ? '⇧' : 'Shift') : null,
      spec.alt ? (is_apple ? '⌥' : 'Alt') : null,
      key_label,
    ].filter((p): p is string => p !== null);
    return parts.join(is_apple ? '' : '+');
  }
}
