import type { JobResult } from '../../jobs_svc/types/job_handler.types.js';
import type { MailSendResult } from '../../mailer_svc/types/mail.types.js';
import { MailDeliveryError } from '../../mailer_svc/mail_delivery_error.js';

/** Shapes a mail send as a job result, for the handlers of email-sending jobs. */
export class MailJobResult {
  private constructor() {}

  /**
   * A relay failure becomes a failed outcome carrying the relay's own verdict on
   * whether a retry could succeed. Anything else - a missing user, a bug - is
   * rethrown for the worker's error policy.
   */
  static async from(send: () => Promise<MailSendResult>): Promise<JobResult> {
    try {
      const { message_id } = await send();
      return { outcome: 'succeeded', summary: { message_id } };
    } catch (err) {
      if (err instanceof MailDeliveryError) {
        return { outcome: 'failed', reason: err.message, retryable: err.retryable };
      }
      throw err;
    }
  }
}
