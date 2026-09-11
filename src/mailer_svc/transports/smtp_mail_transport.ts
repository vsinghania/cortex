import nodemailer, { type SMTPSentMessageInfo, type Transporter } from 'nodemailer';
import type { MailTransport } from './mail_transport.js';
import { SmtpErrorClassifier } from './smtp_error_classifier.js';
import type { SmtpConfig } from '../config/mailer_config.js';
import type { MailSendResult, OutboundMail } from '../types/mail.types.js';
import { MailDeliveryError } from '../mail_delivery_error.js';

export class SmtpMailTransport implements MailTransport {
  readonly kind = 'smtp' as const;

  private constructor(private readonly transporter: Transporter<SMTPSentMessageInfo>) {}

  static create(config: SmtpConfig): SmtpMailTransport {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      connectionTimeout: config.connection_timeout_ms,
      greetingTimeout: config.greeting_timeout_ms,
      socketTimeout: config.socket_timeout_ms
    });
    return new SmtpMailTransport(transporter);
  }

  async send(mail: OutboundMail): Promise<MailSendResult> {
    let info: SMTPSentMessageInfo;
    try {
      info = await this.transporter.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html
      });
    } catch (err) {
      throw SmtpErrorClassifier.classify(err);
    }

    if (info.rejected.length > 0) {
      throw new MailDeliveryError({ error_code: 'recipient_rejected', retryable: false });
    }
    return { message_id: info.messageId };
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify();
    } catch (err) {
      throw SmtpErrorClassifier.classify(err);
    }
  }
}
