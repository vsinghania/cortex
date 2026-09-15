import { useEffect, useState } from 'react';

/** Re-renders on an interval so relative times ("2m ago") stay current. */
export function useNowTick(interval_ms: number): number {
  const [now, set_now] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => set_now(Date.now()), interval_ms);
    return () => window.clearInterval(id);
  }, [interval_ms]);
  return now;
}
