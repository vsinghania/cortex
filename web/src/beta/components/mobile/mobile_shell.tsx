import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { MobileDrawer } from './mobile_drawer';
import { MobileTabBar } from './mobile_tab_bar';

type Props = {
  /** The workspace rail, rendered inside the drawer. Receives a close callback. */
  rail: (close: () => void) => ReactNode;
  /** The compose button for the tab bar's centre slot. */
  fab?: ReactNode;
  /**
   * Detail screens hide the tab bar: they are reached by drilling in rather than switching
   * section, and the editor and composer need the height when the keyboard is up.
   */
  show_tabs?: boolean;
  /** The current screen. Receives an opener for the drawer. */
  children: (openDrawer: () => void) => ReactNode;
};

/**
 * Chrome only — the drawer, the tab bar, and the flex column they bracket. Feature state
 * stays in the page so the mobile and desktop layouts share one orchestrator.
 */
export function MobileShell({ rail, fab, show_tabs = true, children }: Props) {
  const [drawer_open, set_drawer_open] = useState(false);
  const location = useLocation();

  // Navigating from inside the drawer (a folder, a tag, the other tab) should dismiss it.
  useEffect(() => {
    set_drawer_open(false);
  }, [location.key]);

  const closeDrawer = () => set_drawer_open(false);

  return (
    <div className="m-shell">
      {children(() => set_drawer_open(true))}
      {show_tabs && <MobileTabBar>{fab}</MobileTabBar>}
      <MobileDrawer open={drawer_open} onClose={closeDrawer}>
        {rail(closeDrawer)}
      </MobileDrawer>
    </div>
  );
}
