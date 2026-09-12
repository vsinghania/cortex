export type Role = 'user' | 'admin';

export type User = {
  user_id: string; // UUID v4
  email: string;
  name: string;
  password_hash: string;
  roles: Role[];
  created_at: Date;
  updated_at: Date;
  last_login_at?: Date;
  /** Absent until the user clicks a verification link. Pre-existing users start unverified. */
  email_verified_at?: Date;
};

// Service boundary identifier alias to avoid leaking storage concerns
export type user_id = string;

export type CreateUserInput = {
  email: string;
  name: string;
  password_hash: string;
  roles?: Role[];
};

export type UpdateUserPatch = Partial<Pick<User, 'password_hash' | 'roles' | 'last_login_at'>>;
