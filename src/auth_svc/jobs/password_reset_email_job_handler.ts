import { AuthEmailPayloadSchema, AuthJobName, type AuthEmailPayload } from './auth_job.types.js';
import { MailJobResult } from './mail_job_result.js';
import { EmailTokenSender } from '../emails/email_token_sender.js';
import type { JobPayload, RetryPolicy } from '../../jobs_svc/types/job.types.js';
import type { JobHandler, JobResult } from '../../jobs_svc/types/job_handler.types.js';
import { Time } from '../../lib/time.js';

export class PasswordResetEmailJobHandler implements JobHandler<AuthEmailPayload> {
  readonly name = AuthJobName.PasswordResetEmail;
  // Covers the SMTP connect and socket timeouts (10s + 30s) with margin.
  readonly lease_ms = Time.minutesToMs(1);
  // Relay failures are usually brief - greylisting, a rate limit, a blip - and five
  // tries with backoff ride them out while the user is still waiting for the email.
  readonly retry_policy: Partial<RetryPolicy> = { max_attempts: 5 };

  private constructor(private readonly sender: EmailTokenSender) {}

  static async create(params?: { sender?: EmailTokenSender }): Promise<PasswordResetEmailJobHandler> {
    return new PasswordResetEmailJobHandler(params?.sender ?? (await EmailTokenSender.create()));
  }

  parsePayload(raw: JobPayload): AuthEmailPayload {
    return AuthEmailPayloadSchema.parse(raw);
  }

  async handle(payload: AuthEmailPayload): Promise<JobResult> {
    return MailJobResult.fromDeliveryError(() => this.sender.sendTokenEmail({ user_id: payload.user_id, purpose: 'password_reset' }));
  }
}
