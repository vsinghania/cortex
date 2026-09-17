import type { GoogleAuthSvcInterface } from './google_auth_svc_interface.js';
import type { AuthContext } from './types/auth.types.js';
import type {
  CompleteGoogleAuthorizationInput,
  GoogleAuthorization,
  GoogleAuthResult,
  GoogleIdentity,
  GoogleLoginOutcome
} from './types/google_auth.types.js';
import type { User } from '../user/types/user.types.js';
import type { UserRepository } from '../user/repositories/user_repository_interface.js';
import { MongooseUserRepository } from '../user/repositories/user_repository.js';
import type { GoogleOAuthAdapterInterface } from './adapters/google_oauth_adapter_interface.js';
import { GoogleOAuthAdapter } from './adapters/google_oauth_adapter.js';
import { GoogleOAuthConfigLoader } from './config/google_oauth_config.js';
import { SessionIssuer } from './session_issuer.js';
import { TokenUtils } from './utils/token_utils.js';
import { ServiceUnavailableError, UnauthorizedError } from '../common/errors.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';
import { logger } from '../common/logger.js';

const DEFAULT_RETURN_TO = '/notes';
const FALLBACK_NAME = 'Cortex user';

type GoogleAuthSvcDeps = {
  user_repo: UserRepository;
  session_issuer: SessionIssuer;
  google: GoogleOAuthAdapterInterface;
};

type ResolvedUser = { user: User; outcome: GoogleLoginOutcome };

export class GoogleAuthSvc implements GoogleAuthSvcInterface {
  private constructor(private readonly deps: GoogleAuthSvcDeps) {}

  static isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return GoogleOAuthConfigLoader.fromEnv(env) !== null;
  }

  static async create(overrides?: Partial<GoogleAuthSvcDeps>): Promise<GoogleAuthSvc> {
    return new GoogleAuthSvc({
      user_repo: overrides?.user_repo ?? (await MongooseUserRepository.create({ db: DbNameResolver.resolve('user') })),
      session_issuer: overrides?.session_issuer ?? (await SessionIssuer.create()),
      google: overrides?.google ?? GoogleAuthSvc.createAdapter()
    });
  }

  /** Only same-origin paths, so the callback cannot be turned into an open redirect. */
  static sanitizeReturnTo(return_to: string | undefined): string {
    if (!return_to || !return_to.startsWith('/') || return_to.startsWith('//') || return_to.includes('\\')) {
      return DEFAULT_RETURN_TO;
    }
    return return_to;
  }

  private static createAdapter(): GoogleOAuthAdapterInterface {
    const config = GoogleOAuthConfigLoader.fromEnv();
    if (!config) {
      throw new ServiceUnavailableError('Google sign-in is not configured');
    }
    return GoogleOAuthAdapter.create(config);
  }

  startAuthorization(return_to?: string): GoogleAuthorization {
    const state = TokenUtils.generateOpaqueToken(32);
    const code_verifier = TokenUtils.generateOpaqueToken(48);
    const url = this.deps.google.buildAuthorizationUrl({
      state,
      code_challenge: TokenUtils.sha256Base64Url(code_verifier)
    });
    return { url, pending: { state, code_verifier, return_to: GoogleAuthSvc.sanitizeReturnTo(return_to) } };
  }

  async completeAuthorization(input: CompleteGoogleAuthorizationInput, ctx?: AuthContext): Promise<GoogleAuthResult> {
    const start_ms = performance.now();
    if (!TokenUtils.constantTimeEquals(input.state, input.pending.state)) {
      logger.warn({ reason: 'state_mismatch' }, 'google login rejected');
      throw new UnauthorizedError('Google sign-in state mismatch');
    }

    const identity = await this.deps.google.exchangeCode({
      code: input.code,
      code_verifier: input.pending.code_verifier
    });
    const { user, outcome } = await this.resolveUser(identity);
    await this.deps.user_repo.setLastLoginAt(user.user_id, new Date());
    const result = await this.deps.session_issuer.issue(user, ctx);

    logger.info(
      { user_id: user.user_id, outcome, duration_ms: Time.elapsedMs(start_ms) },
      'google login completed'
    );
    return { ...result, return_to: GoogleAuthSvc.sanitizeReturnTo(input.pending.return_to) };
  }

  private async resolveUser(identity: GoogleIdentity): Promise<ResolvedUser> {
    const resolved = await this.findExistingUser(identity);
    if (resolved) return resolved;

    try {
      return { user: await this.createUser(identity), outcome: 'created' };
    } catch (err) {
      // Two callbacks for the same new account can race; the loser finds the winner's row.
      const raced = await this.findExistingUser(identity);
      if (raced) return raced;
      throw err;
    }
  }

  private async findExistingUser(identity: GoogleIdentity): Promise<ResolvedUser | null> {
    const by_sub = await this.deps.user_repo.findByGoogleSub(identity.sub);
    if (by_sub) return { user: by_sub, outcome: 'existing' };

    const by_email = await this.deps.user_repo.findByEmail(identity.email);
    if (!by_email) return null;

    // Linking on an address Google has not verified would let anyone who types that
    // address into a Google account take over the Cortex account behind it.
    if (!identity.email_verified) {
      logger.warn({ reason: 'email_unverified', user_id: by_email.user_id }, 'google login rejected');
      throw new UnauthorizedError('This Google account email is not verified');
    }
    if (by_email.google_sub && by_email.google_sub !== identity.sub) {
      logger.warn({ reason: 'linked_to_other_google_account', user_id: by_email.user_id }, 'google login rejected');
      throw new UnauthorizedError('This account is linked to a different Google account');
    }

    return { user: await this.linkUser(by_email, identity.sub), outcome: 'linked' };
  }

  private async linkUser(user: User, google_sub: string): Promise<User> {
    const user_repo = this.deps.user_repo;
    let linked = (await user_repo.linkGoogleAccount(user.user_id, google_sub)) ?? user;
    if (!linked.email_verified_at) {
      linked = (await user_repo.setEmailVerifiedAt(user.user_id, new Date())) ?? linked;
    }
    return linked;
  }

  private async createUser(identity: GoogleIdentity): Promise<User> {
    if (!identity.email_verified) {
      logger.warn({ reason: 'email_unverified' }, 'google login rejected');
      throw new UnauthorizedError('This Google account email is not verified');
    }
    return this.deps.user_repo.createUser({
      user_id: Id.generateUuidV7(),
      email: identity.email.toLowerCase().trim(),
      name: identity.name?.trim() || FALLBACK_NAME,
      google_sub: identity.sub,
      email_verified_at: new Date(),
      roles: ['user']
    });
  }
}
