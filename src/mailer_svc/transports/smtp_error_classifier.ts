import { MailDeliveryError } from '../mail_delivery_error.js';

/** Without an SMTP reply, these still mean the message or the config is wrong. */
const PERMANENT_CODES = new Set(['EENVELOPE', 'EMESSAGE', 'EAUTH', 'ENOAUTH', 'ECONFIG', 'EMAXRECIPIENTS']);

type SmtpErrorFields = { code?: string; response_code?: number };

export class SmtpErrorClassifier {
  private constructor() {}

  /**
   * The SMTP reply code wins when there is one: 5xx is a refusal, 4xx is the server
   * asking us to come back later. Without a reply the failure happened below SMTP
   * (connection, DNS, TLS, timeout) and is treated as transient.
   */
  static classifyDeliveryError(err: unknown): MailDeliveryError {
    if (err instanceof MailDeliveryError) return err;

    const { code, response_code } = SmtpErrorClassifier.readSmtpErrorFields(err);
    return new MailDeliveryError({
      error_code: code ?? 'unknown',
      response_code,
      retryable: SmtpErrorClassifier.isRetryable({ code, response_code })
    });
  }

  private static isRetryable({ code, response_code }: SmtpErrorFields): boolean {
    if (response_code !== undefined && response_code >= 500) return false;
    if (response_code !== undefined && response_code >= 400) return true;
    return !(code && PERMANENT_CODES.has(code));
  }

  private static readSmtpErrorFields(err: unknown): SmtpErrorFields {
    if (typeof err !== 'object' || err === null) return {};
    const { code, responseCode } = err as { code?: unknown; responseCode?: unknown };
    return {
      code: typeof code === 'string' ? code : undefined,
      response_code: typeof responseCode === 'number' ? responseCode : undefined
    };
  }
}
