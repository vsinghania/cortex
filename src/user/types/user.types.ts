export type Role = 'user' | 'admin';

export type User = {
  user_id: string; // UUID v4
  email: string;
  name: string;
  /** Absent for users who have only ever signed in with Google. */
  password_hash?: string;
  /** Google's stable account id (the ID token `sub`), set once the account is linked. */
  google_sub?: string;
  roles: Role[];
  created_at: Date;
  updated_at: Date;
  last_login_at?: Date;
  /** Absent until the user clicks a verification link. Pre-existing users start unverified. */
  email_verified_at?: Date;
  /**
   * Set on password sign-ups, which cannot sign in until email_verified_at is set. Absent on
   * accounts from before verification became mandatory, so those keep signing in unverified.
   */
  email_verification_required?: boolean;
};

/**
 * A user as the admin users view reads one: the credentials are reduced to whether they
 * exist, in the query, so neither the hash nor the Google id is ever loaded on this path.
 */
export type AdminUserRecord = Omit<User, 'password_hash' | 'google_sub'> & {
  has_password: boolean;
  has_google: boolean;
};

export type ListUsersParams = {
  limit: number;
  offset: number;
};

// Service boundary identifier alias to avoid leaking storage concerns
export type user_id = string;

export type CreateUserInput = {
  email: string;
  name: string;
  password_hash?: string;
  google_sub?: string;
  email_verified_at?: Date;
  email_verification_required?: boolean;
  roles?: Role[];
};

export type UpdateUserPatch = Partial<Pick<User, 'password_hash' | 'roles' | 'last_login_at'>>;
