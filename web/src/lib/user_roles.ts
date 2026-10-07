import type { User } from './auth.types';

export class UserRoles {
  /** Only hides admin UI; the server's role gate is what actually protects it. */
  static isAdmin(user: Pick<User, 'roles'> | null): boolean {
    return user?.roles.includes('admin') ?? false;
  }
}
