import type { IconName } from '../components/icon';
import { AppRoutes } from './app_routes';

export type AppNavItem = {
  to: string;
  label: string;
  icon: IconName;
};

/** The workspace's primary destinations, shared by the desktop rail and the mobile tab bar. */
export class AppNav {
  static readonly ITEMS: AppNavItem[] = [
    { to: AppRoutes.notes(), label: 'Notes', icon: 'notes' },
    { to: AppRoutes.chat(), label: 'Assistant', icon: 'sparkle' },
  ];
}
