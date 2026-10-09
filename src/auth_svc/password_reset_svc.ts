import type { PasswordResetSvcInterface } from './password_reset_svc_interface.js';
import type { ResetPasswordInput } from './types/auth.types.js';
import type { UserRepository } from '../user/repositories/user_repository_interface.js';
import { MongooseUserRepository } from '../user/repositories/user_repository.js';
import type { RefreshTokenRepository } from './repositories/refresh_token_repository_interface.js';
import { MongooseRefreshTokenRepository } from './repositories/refresh_token_repository.js';
import { EmailTokenIssuer } from './email_token_issuer.js';
import { AuthJobName } from './jobs/auth_job.types.js';
import { PasswordUtils } from './utils/password_utils.js';
import type { JobsSvcInterface } from '../jobs_svc/jobs_svc_interface.js';
import { JobsSvc } from '../jobs_svc/jobs_svc.js';
import { JobDedupKey } from '../jobs_svc/job_dedup_key.js';
import { BadRequestError, ConflictError } from '../common/errors.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';

// A reset email this late is no longer being waited for - the user has likely asked
// again - so the worker drops it rather than sending a stale link.
const SEND_DEADLINE_MS = Time.minutesToMs(30);
const INVALID_LINK_MESSAGE = 'This reset link is invalid or has expired. Request a new one.';

type PasswordResetSvcDeps = {
  user_repo: UserRepository;
  rt_repo: RefreshTokenRepository;
  token_issuer: EmailTokenIssuer;
  jobs: Pick<JobsSvcInterface, 'enqueueJob'>;
};

export class PasswordResetSvc implements PasswordResetSvcInterface {
  private constructor(private readonly deps: PasswordResetSvcDeps) {}

  static async create(overrides?: Partial<PasswordResetSvcDeps>): Promise<PasswordResetSvc> {
    return new PasswordResetSvc({
      user_repo: overrides?.user_repo ?? (await MongooseUserRepository.create({ db: DbNameResolver.resolve('user') })),
      rt_repo: overrides?.rt_repo ?? (await MongooseRefreshTokenRepository.create({ db: DbNameResolver.resolve('auth') })),
      token_issuer: overrides?.token_issuer ?? (await EmailTokenIssuer.create()),
      jobs: overrides?.jobs ?? (await JobsSvc.getInstance())
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.deps.user_repo.findByEmail(email);
    if (!user) {
      logger.info({ reason: 'user_not_found' }, 'password reset request ignored');
      return;
    }

    try {
      const { job_id } = await this.deps.jobs.enqueueJob({
        name: AuthJobName.PasswordResetEmail,
        payload: { user_id: user.user_id },
        user_id: user.user_id,
        dedup_key: JobDedupKey.buildDedupKey([AuthJobName.PasswordResetEmail]),
        deadline_at: new Date(Date.now() + SEND_DEADLINE_MS),
        requested_by: user.user_id
      });
      logger.info({ user_id: user.user_id, job_id }, 'password reset requested');
    } catch (err) {
      // A send for this user is already queued or running. A second would only race
      // it, and its fresh token would invalidate the link the first is delivering.
      if (err instanceof ConflictError) {
        logger.info({ user_id: user.user_id, reason: 'send_in_flight' }, 'password reset request ignored');
        return;
      }
      throw err;
    }
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const start_ms = performance.now();

    // Consumed before hashing, so a flood of bogus tokens costs an indexed lookup
    // each rather than a bcrypt round.
    const user_id = await this.deps.token_issuer.consumeEmailToken({ token: input.token, purpose: 'password_reset' });
    if (!user_id) {
      logger.warn({ reason: 'token_invalid' }, 'password reset rejected');
      throw new BadRequestError(INVALID_LINK_MESSAGE);
    }

    const password_hash = await PasswordUtils.hashPassword(input.new_password);
    const updated = await this.deps.user_repo.updateByUserId(user_id, { password_hash });
    if (!updated) {
      logger.warn({ reason: 'user_missing', user_id }, 'password reset rejected');
      throw new BadRequestError(INVALID_LINK_MESSAGE);
    }

    // Whoever holds an old session - possibly the reason for the reset - is logged
    // out on their next refresh.
    const revoked_sessions = await this.deps.rt_repo.revokeSessionsForUser(user_id);

    // Reading the link proves the address is theirs, which is all verification asks
    // for. `updated` predates this write, so an existing timestamp is left alone.
    const verified_on_reset = !updated.email_verified_at;
    if (verified_on_reset) {
      await this.deps.user_repo.setEmailVerifiedAt(user_id, new Date());
    }

    logger.info(
      { user_id, revoked_sessions, verified_on_reset, duration_ms: Time.elapsedMs(start_ms) },
      'password reset completed'
    );
  }
}
