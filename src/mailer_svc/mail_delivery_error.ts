/**
 * The only error MailerSvc.send throws. Callers decide whether to retry from
 * `retryable` alone - mailer_svc deliberately knows nothing about jobs_svc.
 *
 * The message is built from codes only, never from the vendor's error text: SMTP
 * replies routinely quote the recipient address, and this message ends up in logs
 * and in job rows.
 */
export class MailDeliveryError extends Error {
  readonly error_code: string;
  readonly retryable: boolean;
  readonly response_code?: number;

  constructor(params: { error_code: string; retryable: boolean; response_code?: number }) {
    super(MailDeliveryError.describe(params));
    this.name = 'MailDeliveryError';
    this.error_code = params.error_code;
    this.retryable = params.retryable;
    this.response_code = params.response_code;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  private static describe(params: { error_code: string; response_code?: number }): string {
    const reply = params.response_code !== undefined ? ` (smtp ${params.response_code})` : '';
    return `mail delivery failed: ${params.error_code}${reply}`;
  }
}
