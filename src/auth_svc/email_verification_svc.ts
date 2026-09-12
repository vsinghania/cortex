import type { EmailVerificationSvcInterface } from './email_verification_svc_interface.js';
import type { UserRepository } from '../user/repositories/user_repository_interface.js';
import { MongooseUserRepository } from '../user/repositories/user_repository.js';
import { EmailTokenIssuer } from './email_token_issuer.js';
import { AuthJobName } from './jobs/auth_job.types.js';
import type { JobsSvcInterface } from '../jobs_svc/jobs_svc_interface.js';
import { JobsSvc } from '../jobs_svc/jobs_svc.js';
import { JobDedupKey } from '../jobs_svc/job_dedup_key.js';
import { BadRequestError, ConflictError } from '../common/errors.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';

// Far longer than the reset flow's deadline: nobody waits on the registration screen
// for this mail, and a verification link is still worth sending hours later.
const SEND_DEADLINE_MS = Time.daysToMs(1);
const INVALID_LINK_MESSAGE = 'This link is invalid or has expired. Log in to send yourself a new one.';

type EmailVerificationSvcDeps = {
  user_repo: UserRepository;
  token_issuer: EmailTokenIssuer;
  jobs: Pick<JobsSvcInterface, 'enqueue'>;
};

export class EmailVerificationSvc implements EmailVerificationSvcInterface {
  private constructor(private readonly deps: EmailVerificationSvcDeps) {}

  static async create(overrides?: Partial<EmailVerificationSvcDeps>): Promise<EmailVerificationSvc> {
    return new EmailVerificationSvc({
      user_repo: overrides?.user_repo ?? (await MongooseUserRepository.create({ db: DbNameResolver.resolve('user') })),
      token_issuer: overrides?.token_issuer ?? (await EmailTokenIssuer.create()),
      jobs: overrides?.jobs ?? (await JobsSvc.getInstance())
    });
  }

  async requestVerification(user_id: string): Promise<void> {
    const user = await this.deps.user_repo.findByUserId(user_id);
    if (!user) {
      logger.warn({ user_id, reason: 'user_not_found' }, 'email verification request ignored');
      return;
    }
    if (user.email_verified_at) {
      logger.info({ user_id, reason: 'already_verified' }, 'email verification request ignored');
      return;
    }

    try {
      const { job_id } = await this.deps.jobs.enqueue({
        name: AuthJobName.EmailVerificationEmail,
        payload: { user_id },
        user_id,
        dedup_key: JobDedupKey.build([AuthJobName.EmailVerificationEmail]),
        deadline_at: new Date(Date.now() + SEND_DEADLINE_MS),
        requested_by: user_id
      });
      logger.info({ user_id, job_id }, 'email verification requested');
    } catch (err) {
      // A send for this user is already queued or running. A second would only race
      // it, and its fresh token would invalidate the link the first is delivering.
      if (err instanceof ConflictError) {
        logger.info({ user_id, reason: 'send_in_flight' }, 'email verification request ignored');
        return;
      }
      throw err;
    }
  }

  async verify(token: string): Promise<void> {
    const start_ms = performance.now();

    const user_id = await this.deps.token_issuer.consume({ token, purpose: 'email_verification' });
    if (!user_id) {
      logger.warn({ reason: 'token_invalid' }, 'email verification rejected');
      throw new BadRequestError(INVALID_LINK_MESSAGE);
    }

    const updated = await this.deps.user_repo.setEmailVerifiedAt(user_id, new Date());
    if (!updated) {
      logger.warn({ user_id, reason: 'user_missing' }, 'email verification rejected');
      throw new BadRequestError(INVALID_LINK_MESSAGE);
    }

    logger.info({ user_id, duration_ms: Time.elapsedMs(start_ms) }, 'email verification completed');
  }
}
