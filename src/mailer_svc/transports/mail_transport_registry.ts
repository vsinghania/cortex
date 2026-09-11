import type { MailerConfig } from '../config/mailer_config.js';
import type { MailTransportKind } from '../types/mail.types.js';
import type { MailTransport } from './mail_transport.js';
import { SmtpMailTransport } from './smtp_mail_transport.js';

export class MailTransportRegistry {
  private constructor() {}

  // A Record rather than a Map so adding a MailTransportKind fails to compile until
  // it has a factory here.
  private static readonly factories: Record<MailTransportKind, (config: MailerConfig) => MailTransport> = {
    smtp: (config) => SmtpMailTransport.create(config.smtp)
  };

  static build(config: MailerConfig): MailTransport {
    return MailTransportRegistry.factories[config.transport](config);
  }
}
