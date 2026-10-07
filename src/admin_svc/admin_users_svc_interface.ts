import type { AdminUserPage, ListAdminUsersParams } from './types/admin_user.types.js';

export interface AdminUsersSvcInterface {
  listUsers(params: ListAdminUsersParams): Promise<AdminUserPage>;
}
