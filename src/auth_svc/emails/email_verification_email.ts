import type { RenderedMail } from '../../mailer_svc/types/mail.types.js';
import { EmailLayout } from '../../mailer_svc/templates/email_layout.js';

export class EmailVerificationEmail {
  static readonly template = 'email_verification';

  private constructor() {}

  static render(params: { name: string; link: string; expires_in_hours: number }): RenderedMail {
    const expiry = `The link expires in ${params.expires_in_hours} hours and works once.`;
    const not_you = "If you didn't create a Cortex account, ignore this email and nothing happens.";

    return {
      subject: 'Verify your Cortex email address',
      text: [
        `Hi ${params.name},`,
        'Confirm this is your email address so we can reach you about your Cortex account:',
        params.link,
        expiry,
        not_you
      ].join('\n\n'),
      html: EmailLayout.wrap({
        title: 'Verify your email address',
        preheader: expiry,
        body_html:
          EmailLayout.paragraph(`Hi ${params.name},`) +
          EmailLayout.paragraph('Confirm this is your email address so we can reach you about your Cortex account.') +
          EmailLayout.button({ href: params.link, label: 'Verify my email' }) +
          EmailLayout.paragraph(expiry) +
          EmailLayout.paragraph(not_you)
      })
    };
  }
}
