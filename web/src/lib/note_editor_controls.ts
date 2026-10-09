import { Hotkey } from './hotkey';
import type { HotkeySpec } from './hotkey';

export class NoteEditorControls {
  private static readonly MODE_TOGGLE_HOTKEY: HotkeySpec = { mod: true, shift: true, code: 'KeyE' };

  static matchesModeToggle(event: KeyboardEvent): boolean {
    return !event.repeat && !event.isComposing && Hotkey.matches(event, NoteEditorControls.MODE_TOGGLE_HOTKEY);
  }

  static modeToggleLabel(): string {
    return Hotkey.label(NoteEditorControls.MODE_TOGGLE_HOTKEY, 'E');
  }

  static isInteractivePreviewTarget(target: EventTarget): boolean {
    return target instanceof Element && !!target.closest('a, button, input, textarea, select, [contenteditable="true"]');
  }
}
