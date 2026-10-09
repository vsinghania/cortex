import type { UserRepository } from '../../user/repositories/user_repository_interface.js';
import { MongooseUserRepository } from '../../user/repositories/user_repository.js';
import type { User } from '../../user/types/user.types.js';
import type { EmailTokenPurpose } from '../types/email_token.types.js';
import { EmailTokenIssuer } from '../email_token_issuer.js';
import { AppLinks } from '../app_links.js';
import { PasswordResetEmail } from './password_reset_email.js';
import { EmailVerificationEmail } from './email_verification_email.js';
import type { MailerSvcInterface } from '../../mailer_svc/mailer_svc_interface.js';
import { MailerSvc } from '../../mailer_svc/mailer_svc.js';
import type { MailMessage, MailSendResult } from '../../mailer_svc/types/mail.types.js';
import { PermanentJobError } from '../../jobs_svc/job_errors.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';
import { Time } from '../../lib/time.js';

type EmailTokenSenderDeps = {
  user_repo: UserRepository;
  token_issuer: EmailTokenIssuer;
  // Resolved per send rather than at construction. Handlers are built at boot, and
  // a missing SMTP or APP_PUBLIC_URL setting must fail a send - which retries -
  // not the boot.
  mailer: () => MailerSvcInterface;
  links: () => AppLinks;
};

/**
 * Sends the email that carries an email token: one case per EmailTokenPurpose.
 * Account emails without a token (security notices, welcome) do not belong here.
 */
export class EmailTokenSender {
  private constructor(private readonly deps: EmailTokenSenderDeps) {}

  static async create(overrides?: Partial<EmailTokenSenderDeps>): Promise<EmailTokenSender> {
    return new EmailTokenSender({
      user_repo: overrides?.user_repo ?? (await MongooseUserRepository.create({ db: DbNameResolver.resolve('user') })),
      token_issuer: overrides?.token_issuer ?? (await EmailTokenIssuer.create()),
      mailer: overrides?.mailer ?? (() => MailerSvc.getInstance()),
      links: overrides?.links ?? (() => AppLinks.fromEnv())
    });
  }

  /**
   * Issues a fresh token, then mails it. Issuing replaces any earlier link, so a
   * retry after a failed send only replaces a token that never reached anyone.
   */
  async sendTokenEmail(params: { user_id: string; purpose: EmailTokenPurpose }): Promise<MailSendResult> {
    const user = await this.deps.user_repo.findByUserId(params.user_id);
    if (!user) {
      // Its only callers are job handlers, so this is phrased in the queue's terms:
      // no retry can bring a deleted user back.
      throw new PermanentJobError('user not found', { error_code: 'user_not_found' });
    }

    const { token } = await this.deps.token_issuer.issueEmailToken({ user_id: user.user_id, purpose: params.purpose });
    return this.deps.mailer().sendMail(this.composeTokenEmail(params.purpose, user, token));
  }

  private composeTokenEmail(purpose: EmailTokenPurpose, user: User, token: string): MailMessage {
    // Each case phrases its own expiry: the TTLs differ by orders of magnitude,
    // and "1440 minutes" is not what a reader wants to see.
    const ttl_ms = EmailTokenIssuer.getTokenTtlMs(purpose);
    switch (purpose) {
      case 'password_reset':
        return {
          to: user.email,
          template: PasswordResetEmail.template,
          ...PasswordResetEmail.render({
            name: user.name,
            link: this.deps.links().buildPasswordResetUrl(token),
            expires_in_min: Time.msToMinutes(ttl_ms)
          })
        };
      case 'email_verification':
        return {
          to: user.email,
          template: EmailVerificationEmail.template,
          ...EmailVerificationEmail.render({
            name: user.name,
            link: this.deps.links().buildEmailVerificationUrl(token),
            expires_in_hours: Time.msToHours(ttl_ms)
          })
        };
    }
  }
}
