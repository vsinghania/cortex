import { useCallback, useState } from 'react';

type FlagUpdate = boolean | ((current: boolean) => boolean);

/** A boolean UI preference (collapsed panes and the like) remembered across visits. */
export function usePersistedFlag(storage_key: string, initial: boolean): [boolean, (update: FlagUpdate) => void] {
  const [value, set_value] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storage_key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: FlagUpdate) => {
      set_value((current) => {
        const resolved = typeof next === 'function' ? next(current) : next;
        try {
          localStorage.setItem(storage_key, resolved ? '1' : '0');
        } catch {
          // Unavailable storage just means the preference lasts for this visit.
        }
        return resolved;
      });
    },
    [storage_key],
  );

  return [value, update];
}
