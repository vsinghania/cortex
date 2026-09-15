import { useEffect, useRef } from 'react';
import { Hotkey } from './hotkey';
import type { HotkeySpec } from './hotkey';

export function useHotkey(spec: HotkeySpec, handler: (event: KeyboardEvent) => void, enabled = true) {
  const handler_ref = useRef(handler);
  handler_ref.current = handler;
  const { key, code, mod, shift, alt } = spec;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!Hotkey.matches(event, { key, code, mod, shift, alt })) return;
      event.preventDefault();
      handler_ref.current(event);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, key, code, mod, shift, alt]);
}
