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
import { MongooseUserRepository } from '../user/repositories/user_repository.js';
import type { UserRepository } from '../user/repositories/user_repository_interface.js';
import { MongooseRefreshTokenRepository } from './repositories/refresh_token_repository.js';
import type { EmailVerificationSvcInterface } from './email_verification_svc_interface.js';
import { EmailVerificationSvc } from './email_verification_svc.js';
import type { RefreshTokenRepository } from './repositories/refresh_token_repository_interface.js';
import { PasswordUtils } from './utils/password_utils.js';
import { TokenUtils } from './utils/token_utils.js';
import { SessionIssuer } from './session_issuer.js';
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '../common/errors.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';
import { logger } from '../common/logger.js';

const USER_DB = DbNameResolver.resolve('user');
const AUTH_DB = DbNameResolver.resolve('auth');

type AuthSvcDeps = {
  user_repo: UserRepository;
  rt_repo: RefreshTokenRepository;
  email_verification: Pick<EmailVerificationSvcInterface, 'requestVerification'>;
  session_issuer: SessionIssuer;
};

export class AuthSvc implements AuthSvcInterface {
  private constructor(private readonly deps: AuthSvcDeps) {}

  static async create(overrides?: Partial<AuthSvcDeps>): Promise<AuthSvc> {
    const rt_repo = overrides?.rt_repo ?? (await MongooseRefreshTokenRepository.create({ db: AUTH_DB }));
    return new AuthSvc({
      user_repo: overrides?.user_repo ?? (await MongooseUserRepository.create({ db: USER_DB })),
      rt_repo,
      email_verification: overrides?.email_verification ?? (await EmailVerificationSvc.create()),
      session_issuer: overrides?.session_issuer ?? (await SessionIssuer.create(rt_repo))
    });
  }

  async register(input: RegisterInput, ctx?: AuthContext): Promise<AuthResult> {
    const start_ms = performance.now();
    const user_repo = this.deps.user_repo;
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

    const result = await this.deps.session_issuer.issue(created, ctx);

    await this.requestVerificationEmail(created.user_id);

    logger.info(
      {
        user_id: created.user_id,
        role_count: created.roles.length,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'user registered'
    );

    return result;
  }

  async login(input: LoginInput, ctx?: AuthContext): Promise<AuthResult> {
    const start_ms = performance.now();
    const user_repo = this.deps.user_repo;
    const user = await user_repo.findByEmail(input.email);
    if (!user) {
      logger.warn({ reason: 'user_not_found' }, 'login rejected');
      throw new UnauthorizedError('Invalid credentials');
    }

    if (!user.password_hash) {
      logger.warn({ reason: 'no_password_set', user_id: user.user_id }, 'login rejected');
      throw new UnauthorizedError('Invalid credentials');
    }

    const valid = await PasswordUtils.verifyPassword(input.password, user.password_hash);
    if (!valid) {
      logger.warn({ reason: 'bad_password', user_id: user.user_id }, 'login rejected');
      throw new UnauthorizedError('Invalid credentials');
    }

    // Update last_login_at (best effort)
    await user_repo.setLastLoginAt(user.user_id, new Date());

    const result = await this.deps.session_issuer.issue(user, ctx);

    logger.info(
      { user_id: user.user_id, duration_ms: Time.elapsedMs(start_ms) },
      'user logged in'
    );

    return result;
  }

  /**
   * Whose live session a refresh token belongs to, without rotating it - for browser
   * navigations such as an OAuth callback, which carry the refresh cookie but no
   * bearer token. Null for a missing, revoked or expired session.
   */
  async sessionUserId(refresh_token: string | undefined): Promise<string | null> {
    if (!refresh_token) return null;
    const session = await this.deps.rt_repo.findByTokenHash(TokenUtils.sha256Base64Url(refresh_token));
    if (!session || session.revoked_at || session.expires_at.getTime() <= Date.now()) return null;
    return session.user_id;
  }

  async refresh(refresh_token: string, ctx?: AuthContext): Promise<RefreshResult> {
    if (!refresh_token || typeof refresh_token !== 'string') {
      throw new BadRequestError('Missing refresh token');
    }

    const token_hash = TokenUtils.sha256Base64Url(refresh_token);
    const rt_repo = this.deps.rt_repo;
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
    const user_repo = this.deps.user_repo;
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
    const rt_repo = this.deps.rt_repo;
    await rt_repo.revokeByTokenHash(token_hash).catch(() => void 0);
    logger.info({}, 'user logged out');
    return { success: true };
  }

  async getMe(user_id: string): Promise<MeResult> {
    const user_repo = this.deps.user_repo;
    const user = await user_repo.findByUserId(user_id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return SessionIssuer.toPublicUser(user);
  }

  /**
   * Best effort. The account exists and the caller is already signed in, so a queue
   * that is down must not turn a successful registration into an error; the user can
   * still ask for the mail again from the banner.
   */
  private async requestVerificationEmail(user_id: string): Promise<void> {
    try {
      await this.deps.email_verification.requestVerification(user_id);
    } catch (err) {
      logger.warn({ err, user_id }, 'verification email could not be requested');
    }
  }
}
