import type { User } from '../../lib/auth.types';

export class UserInitials {
  private static readonly MAX_LETTERS = 2;

  static from(user: Pick<User, 'name' | 'email'> | null): string {
    const words = (user?.name ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      return words
        .slice(0, UserInitials.MAX_LETTERS)
        .map((w) => w.charAt(0))
        .join('')
        .toUpperCase();
    }
    return (user?.email ?? '?').charAt(0).toUpperCase();
  }
}
