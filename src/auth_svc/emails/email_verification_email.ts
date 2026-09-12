import type { RenderedMail } from '../../mailer_svc/types/mail.types.js';
import { EmailLayout } from '../../mailer_svc/templates/email_layout.js';

export class EmailVerificationEmail {
  static readonly template = 'email_verification';

  private constructor() {}

  static render(params: { name: string; link: string; expires_in_hours: number }): RenderedMail {
    const expiry = `The link expires in ${params.expires_in_hours} hours and works once.`;
    const not_you = "If you didn't sign up for Cortex, you can ignore this email.";

    return {
      subject: 'Confirm your email address',
      text: [
        `Hi ${params.name},`,
        'Confirm your email address for Cortex:',
        params.link,
        expiry,
        not_you
      ].join('\n\n'),
      html: EmailLayout.wrap({
        title: 'Confirm your email address',
        preheader: expiry,
        body_html:
          EmailLayout.paragraph(`Hi ${params.name},`) +
          EmailLayout.paragraph('Confirm your email address for Cortex.') +
          EmailLayout.button({ href: params.link, label: 'Confirm my email' }) +
          EmailLayout.paragraph(expiry) +
          EmailLayout.paragraph(not_you)
      })
    };
  }
}
