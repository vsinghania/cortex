import { Hotkey } from './hotkey';
import type { HotkeySpec } from './hotkey';

type VoiceLaunchState = { voice_autostart: true };

/** How the rest of the app opens voice: the global shortcut, and the router state that says "start listening". */
export class VoiceLaunch {
  /** ⌥V types "√" on a Mac, so the physical key is matched. */
  static readonly HOTKEY: HotkeySpec = { mod: true, alt: true, code: 'KeyV' };

  /** Arriving with this state starts a session at once: the shortcut already said what the user wants. */
  static readonly AUTOSTART_STATE: VoiceLaunchState = { voice_autostart: true };

  static hotkeyLabel(): string {
    return Hotkey.label(VoiceLaunch.HOTKEY, 'V');
  }

  static wantsAutostart(location_state: unknown): boolean {
    return (location_state as Partial<VoiceLaunchState> | null)?.voice_autostart === true;
  }
}
