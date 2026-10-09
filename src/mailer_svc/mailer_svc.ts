import type { MailerSvcInterface } from './mailer_svc_interface.js';
import type { MailMessage, MailSendResult } from './types/mail.types.js';
import type { MailTransport } from './transports/mail_transport.js';
import { MailTransportRegistry } from './transports/mail_transport_registry.js';
import { MailerConfigLoader, type MailerConfig } from './config/mailer_config.js';
import { MailDeliveryError } from './mail_delivery_error.js';
import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';

/**
 * Generic delivery only. Domain modules own their templates and the jobs that
 * send them, and hand this a finished message - so mailer_svc never names a
 * domain concept (asserted in scripts/layering.test.ts).
 */
export class MailerSvc implements MailerSvcInterface {
  private static instance: MailerSvc | null = null;

  private constructor(
    private readonly transport: MailTransport,
    private readonly from: string
  ) {}

  /**
   * Lazy on purpose: nothing at boot needs mail, so a missing SMTP config fails the
   * first send - which a job can retry - instead of the whole process.
   */
  static getInstance(): MailerSvc {
    if (!MailerSvc.instance) {
      MailerSvc.instance = MailerSvc.create({ config: MailerConfigLoader.fromEnv() });
    }
    return MailerSvc.instance;
  }

  static create(params: { config: MailerConfig; transport?: MailTransport }): MailerSvc {
    const transport = params.transport ?? MailTransportRegistry.createTransport(params.config);
    logger.info({ transport: transport.kind }, 'Mailer loaded');
    return new MailerSvc(transport, params.config.from);
  }

  async sendMail(message: MailMessage): Promise<MailSendResult> {
    const start_ms = performance.now();
    try {
      const result = await this.transport.sendMail({ ...message, from: this.from });
      logger.info(
        {
          template: message.template,
          transport: this.transport.kind,
          message_id: result.message_id,
          duration_ms: Time.elapsedMs(start_ms)
        },
        'mail sent'
      );
      return result;
    } catch (err) {
      const delivery_err = MailerSvc.toMailDeliveryError(err);
      logger.error(
        {
          err: delivery_err,
          template: message.template,
          transport: this.transport.kind,
          retryable: delivery_err.retryable,
          duration_ms: Time.elapsedMs(start_ms)
        },
        'mail send failed'
      );
      throw delivery_err;
    }
  }

  async verifyTransportConnection(): Promise<void> {
    await this.transport.verifyTransportConnection();
  }

  /**
   * Transports only throw MailDeliveryError, so anything else is a bug. It is not
   * logged as-is because its message could quote the recipient.
   */
  private static toMailDeliveryError(err: unknown): MailDeliveryError {
    if (err instanceof MailDeliveryError) return err;
    const error_code = err instanceof Error ? `unexpected_${err.name}` : 'unexpected';
    return new MailDeliveryError({ error_code, retryable: true });
  }
}
