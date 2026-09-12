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

export type RefreshResponse = {
  access_token: string;
  access_token_expires_in_sec: number;
};
