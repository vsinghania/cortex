import { AppRoutes } from './app_routes';
import type { AppNavItem } from './app_nav';

/** The admin area's views, listed in its rail section. New admin views are added here. */
export class AdminNav {
  static readonly ENTRY: AppNavItem = { to: AppRoutes.admin(), label: 'Admin', icon: 'shield' };

  static readonly ITEMS: AppNavItem[] = [
    { to: AppRoutes.adminUsers(), label: 'Users', icon: 'users' },
  ];
}
