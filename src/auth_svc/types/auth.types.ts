import type { Role, User } from '../../user/types/user.types.js';

export type RegisterInput = {
  email: string;
  name: string;
  password: string;
  roles?: Role[];
};

export type LoginInput = {
  email: string;
  password: string;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string; // opaque token; controller must set as HttpOnly cookie
  access_token_expires_in_sec: number;
  refresh_token_expires_in_sec: number;
};

export type AuthContext = {
  ip?: string | null;
  user_agent?: string | null;
};

export type AuthResult = {
  user: Omit<User, 'password_hash'>;
  tokens: TokenPair;
};

export type MeResult = Omit<User, 'password_hash'>;

export type RefreshResult = {
  tokens: TokenPair;
};

export type LogoutResult = { success: true };

export type JwtClaims = {
  sub: string; // user_id (UUID)
  roles: Role[];
  iat: number;
  exp: number;
  iss?: string;
  aud?: string | string[];
};

export type IssueTokenParams = {
  user_id: string;
  roles: Role[];
};

export type RefreshSession = {
  user_id: string;
  token_hash: string;
  user_agent?: string | null;
  ip?: string | null;
  expires_at: Date;
  revoked_at?: Date;
  replaced_by?: string;
  created_at: Date;
  updated_at: Date;
};
