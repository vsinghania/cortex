import type { AuthSvcInterface } from './auth_svc_interface.js';
import type {
  AuthContext,
  AuthResult,
  LoginInput,
  LogoutResult,
  MeResult,
  RefreshResult,
  RegisterInput
} from './types/auth.types.js';
import type { User } from '../user/types/user.types.js';
import { MongooseUserRepository } from '../user/repositories/user_repository.js';
import type { UserRepository } from '../user/repositories/user_repository_interface.js';
import { MongooseRefreshTokenRepository } from './repositories/refresh_token_repository.js';
import type { RefreshTokenRepository } from './repositories/refresh_token_repository_interface.js';
import { PasswordUtils } from './utils/password_utils.js';
import { TokenUtils } from './utils/token_utils.js';
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '../common/errors.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';
import { logger } from '../common/logger.js';

const USER_DB = DbNameResolver.resolve('user');
const AUTH_DB = DbNameResolver.resolve('auth');


export class AuthSvc implements AuthSvcInterface {
  private user_repo!: UserRepository;
  private rt_repo!: RefreshTokenRepository;

  private static redactUser(user: User): Omit<User, 'password_hash'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...rest } = user as any;
    return rest;
  }

  async init(): Promise<void> {
    this.user_repo = await MongooseUserRepository.create({ db: USER_DB });
    this.rt_repo = await MongooseRefreshTokenRepository.create({ db: AUTH_DB });
  }

  static async create(): Promise<AuthSvc> {
    const svc = new AuthSvc();
    await svc.init();
    return svc;
  }

  async register(input: RegisterInput, ctx?: AuthContext): Promise<AuthResult> {
    const start_ms = performance.now();
    const user_repo = this.user_repo;
    const existing = await user_repo.findByEmail(input.email);
    if (existing) {
      logger.warn({ reason: 'email_taken' }, 'user registration rejected');
      throw new ConflictError('Email already registered');
    }

    const password_hash = await PasswordUtils.hashPassword(input.password);
    const user_id = Id.generateUuidV7();

    const created = await user_repo.createUser({
      user_id,
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      password_hash,
      roles: input.roles ?? ['user']
    });

    const { token: access_token } = TokenUtils.signAccessToken({ user_id: created.user_id, roles: created.roles });
    const { token: refresh_token, token_hash, expires_at } = TokenUtils.issueRefreshToken();
    const rt_repo = this.rt_repo;
    await rt_repo.createSession({
      user_id: created.user_id,
      token_hash,
      user_agent: ctx?.user_agent ?? null,
      ip: ctx?.ip ?? null,
      expires_at
    });

    logger.info(
      {
        user_id: created.user_id,
        role_count: created.roles.length,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'user registered'
    );

    return {
      user: AuthSvc.redactUser(created),
      tokens: {
        access_token,
        refresh_token,
        access_token_expires_in_sec: TokenUtils.accessTokenTtlSec(),
        refresh_token_expires_in_sec: TokenUtils.refreshTokenTtlSec()
      }
    };
  }

  async login(input: LoginInput, ctx?: AuthContext): Promise<AuthResult> {
    const start_ms = performance.now();
    const user_repo = this.user_repo;
    const user = await user_repo.findByEmail(input.email);
    if (!user) {
      logger.warn({ reason: 'user_not_found' }, 'login rejected');
      throw new UnauthorizedError('Invalid credentials');
    }

    const valid = await PasswordUtils.verifyPassword(input.password, user.password_hash);
    if (!valid) {
      logger.warn({ reason: 'bad_password', user_id: user.user_id }, 'login rejected');
      throw new UnauthorizedError('Invalid credentials');
    }

    // Update last_login_at (best effort)
    await user_repo.setLastLoginAt(user.user_id, new Date());

    const { token: access_token } = TokenUtils.signAccessToken({ user_id: user.user_id, roles: user.roles });
    const { token: refresh_token, token_hash, expires_at } = TokenUtils.issueRefreshToken();
    const rt_repo = this.rt_repo;
    await rt_repo.createSession({
      user_id: user.user_id,
      token_hash,
      user_agent: ctx?.user_agent ?? null,
      ip: ctx?.ip ?? null,
      expires_at
    });

    logger.info(
      { user_id: user.user_id, duration_ms: Time.elapsedMs(start_ms) },
      'user logged in'
    );

    return {
      user: AuthSvc.redactUser(user),
      tokens: {
        access_token,
        refresh_token,
        access_token_expires_in_sec: TokenUtils.accessTokenTtlSec(),
        refresh_token_expires_in_sec: TokenUtils.refreshTokenTtlSec()
      }
    };
  }

  async refresh(refresh_token: string, ctx?: AuthContext): Promise<RefreshResult> {
    if (!refresh_token || typeof refresh_token !== 'string') {
      throw new BadRequestError('Missing refresh token');
    }

    const token_hash = TokenUtils.sha256Base64Url(refresh_token);
    const rt_repo = this.rt_repo;
    const session = await rt_repo.findByTokenHash(token_hash);
    if (!session) {
      logger.warn({ reason: 'session_not_found' }, 'refresh rejected');
      throw new UnauthorizedError('Invalid refresh token');
    }
    if (session.revoked_at) {
      logger.warn({ reason: 'session_revoked', user_id: session.user_id }, 'refresh rejected');
      throw new UnauthorizedError('Refresh token revoked');
    }
    if (session.expires_at.getTime() <= Date.now()) {
      // prune or mark as revoked for hygiene (best effort)
      await rt_repo.revokeByTokenHash(token_hash).catch(() => void 0);
      logger.warn({ reason: 'session_expired', user_id: session.user_id }, 'refresh rejected');
      throw new UnauthorizedError('Refresh token expired');
    }

    // Load user
    const user_repo = this.user_repo;
    const user = await user_repo.findByUserId(session.user_id);
    if (!user) {
      // Revoke session if user missing
      await rt_repo.revokeByTokenHash(token_hash).catch(() => void 0);
      logger.warn({ reason: 'user_missing', user_id: session.user_id }, 'refresh rejected');
      throw new NotFoundError('User not found for refresh token');
    }

    const { token: new_access } = TokenUtils.signAccessToken({ user_id: user.user_id, roles: user.roles });
    const { token: new_refresh, token_hash: new_hash, expires_at: new_expires } = TokenUtils.issueRefreshToken();

    // Rotate session
    const rotated = await rt_repo.rotateSession({
      old_token_hash: token_hash,
      new_token_hash: new_hash,
      new_expires_at: new_expires
    });
    if (!rotated) {
      logger.warn({ reason: 'rotation_failed', user_id: user.user_id }, 'refresh rejected');
      throw new UnauthorizedError('Refresh token rotation failed');
    }

    // Attach latest UA/IP (best effort)
    // Not strictly required; skip write if not provided
    if (ctx?.ip || ctx?.user_agent) {
      // no-op for now; could patch created refresh doc if we want freshest ctx on the new token
    }

    return {
      tokens: {
        access_token: new_access,
        refresh_token: new_refresh,
        access_token_expires_in_sec: TokenUtils.accessTokenTtlSec(),
        refresh_token_expires_in_sec: TokenUtils.refreshTokenTtlSec()
      }
    };
  }

  async logout(refresh_token: string): Promise<LogoutResult> {
    if (!refresh_token) return { success: true };
    const token_hash = TokenUtils.sha256Base64Url(refresh_token);
    const rt_repo = this.rt_repo;
    await rt_repo.revokeByTokenHash(token_hash).catch(() => void 0);
    logger.info({}, 'user logged out');
    return { success: true };
  }

  async getMe(user_id: string): Promise<MeResult> {
    const user_repo = this.user_repo;
    const user = await user_repo.findByUserId(user_id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return AuthSvc.redactUser(user);
  }
}
