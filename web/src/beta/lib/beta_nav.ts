import type { IconName } from '../../components/icon';
import { BetaRoutes } from './beta_routes';

export type BetaNavItem = {
  to: string;
  label: string;
  icon: IconName;
};

/** The workspace's primary destinations, shared by the desktop rail and the mobile tab bar. */
export class BetaNav {
  static readonly ITEMS: BetaNavItem[] = [
    { to: BetaRoutes.notes(), label: 'Notes', icon: 'notes' },
    { to: BetaRoutes.chat(), label: 'Assistant', icon: 'sparkle' },
  ];
}
