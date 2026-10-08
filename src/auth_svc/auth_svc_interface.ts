import type {
  AuthContext,
  AuthResult,
  LoginInput,
  LogoutResult,
  MeResult,
  RefreshResult,
  RegisterInput,
  RegisterResult
} from './types/auth.types.js';

export interface AuthSvcInterface {
  register(input: RegisterInput): Promise<RegisterResult>;
  login(input: LoginInput, ctx?: AuthContext): Promise<AuthResult>;
  refresh(refresh_token: string, ctx?: AuthContext): Promise<RefreshResult>;
  logout(refresh_token: string): Promise<LogoutResult>;
  getMe(user_id: string): Promise<MeResult>;
  sessionUserId(refresh_token: string | undefined): Promise<string | null>;
}
