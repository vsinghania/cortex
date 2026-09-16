import { useSyncExternalStore } from 'react';

export const MOBILE_MAX_WIDTH_PX = 700;

const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

/**
 * Mobile is a structurally different shell rather than a restyle, so the breakpoint is
 * defined once here and mirrored into CSS as `[data-layout='mobile']` on the root. Styling
 * follows that attribute instead of repeating the media query, so the JS branch and the
 * stylesheet can never disagree about which layout is on screen.
 */
class MobileViewport {
  private static readonly query = window.matchMedia(MOBILE_MEDIA_QUERY);

  static subscribe(onChange: () => void): () => void {
    MobileViewport.query.addEventListener('change', onChange);
    return () => MobileViewport.query.removeEventListener('change', onChange);
  }

  static matches(): boolean {
    return MobileViewport.query.matches;
  }
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(MobileViewport.subscribe, MobileViewport.matches, MobileViewport.matches);
}
