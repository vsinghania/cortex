import type { MailSendResult, MailTransportKind, OutboundMail } from '../types/mail.types.js';

/** Implementations throw MailDeliveryError and nothing else. */
export interface MailTransport {
  readonly kind: MailTransportKind;
  sendMail(mail: OutboundMail): Promise<MailSendResult>;
  /** Checks connectivity and credentials without sending anything. */
  verifyTransportConnection(): Promise<void>;
}
