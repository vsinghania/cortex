import type { MailMessage, MailSendResult } from './types/mail.types.js';

export interface MailerSvcInterface {
  /**
   * Delivers one message. Throws MailDeliveryError only; its `retryable` says
   * whether sending the same message again could succeed.
   */
  send(message: MailMessage): Promise<MailSendResult>;

  /** Checks the transport's connectivity and credentials without sending. */
  verify(): Promise<void>;
}
