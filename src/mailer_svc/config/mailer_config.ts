import { z } from 'zod';
import { Env } from '../../lib/env.js';
import type { MailTransportKind } from '../types/mail.types.js';
import { Time } from '../../lib/time.js';

const DEFAULT_SMTP_PORT = 587;
const IMPLICIT_TLS_SMTP_PORT = 465;

export type SmtpConfig = {
  host: string;
  port: number;
  /** true = TLS from the first byte; false = plain, upgraded via STARTTLS when offered. */
  secure: boolean;
  auth?: { user: string; pass: string };
  connection_timeout_ms: number;
  greeting_timeout_ms: number;
  socket_timeout_ms: number;
};

export type MailerConfig = {
  transport: MailTransportKind;
  from: string;
  smtp: SmtpConfig;
};

const EnvSchema = z
  .object({
    MAIL_TRANSPORT: Env.normalizeEmptyStringAsUndefined(z.enum(['smtp']).default('smtp')),
    MAIL_FROM: z.string().trim().min(1),
    SMTP_HOST: z.string().trim().min(1),
    SMTP_PORT: Env.normalizeEmptyStringAsUndefined(z.coerce.number().int().min(1).max(65535).optional()),
    SMTP_SECURE: Env.normalizeEmptyStringAsUndefined(z.string().optional()),
    SMTP_USER: Env.normalizeEmptyStringAsUndefined(z.string().optional()),
    SMTP_PASS: Env.normalizeEmptyStringAsUndefined(z.string().optional())
  })
  .refine((env) => Boolean(env.SMTP_USER) === Boolean(env.SMTP_PASS), {
    message: 'SMTP_USER and SMTP_PASS must be set together',
    path: ['SMTP_USER']
  });

export class MailerConfigLoader {
  private constructor() {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): MailerConfig {
    const parsed = EnvSchema.parse(env);
    const port = parsed.SMTP_PORT ?? DEFAULT_SMTP_PORT;

    return {
      transport: parsed.MAIL_TRANSPORT,
      from: parsed.MAIL_FROM,
      smtp: {
        host: parsed.SMTP_HOST,
        port,
        secure: MailerConfigLoader.parseBooleanSetting(parsed.SMTP_SECURE, port === IMPLICIT_TLS_SMTP_PORT),
        auth: parsed.SMTP_USER && parsed.SMTP_PASS ? { user: parsed.SMTP_USER, pass: parsed.SMTP_PASS } : undefined,
        connection_timeout_ms: Time.secondsToMs(10),
        greeting_timeout_ms: Time.secondsToMs(10),
        // nodemailer defaults to 10 minutes, far past a job lease. A hung server has
        // to fail the attempt so the caller's retry policy can take over.
        socket_timeout_ms: Time.secondsToMs(30)
      }
    };
  }

  private static parseBooleanSetting(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined || raw.trim() === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }
}
