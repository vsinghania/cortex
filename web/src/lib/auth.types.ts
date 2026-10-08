export type Role = 'user' | 'admin';

export type User = {
  user_id: string;
  email: string;
  name: string;
  roles: Role[];
  created_at: string;
  updated_at: string;
  last_login_at?: string;
  email_verified_at?: string;
};

export type AuthResponse = {
  user: User;
  access_token: string;
  access_token_expires_in_sec: number;
};

/** Registration starts no session: the account signs in once its email is confirmed. */
export type RegisterResponse = {
  user: User;
  verification_required: true;
};

export type RefreshResponse = {
  access_token: string;
  access_token_expires_in_sec: number;
};
