import type { RenderedMail } from '../../mailer_svc/types/mail.types.js';
import { EmailLayout } from '../../mailer_svc/templates/email_layout.js';

export class PasswordResetEmail {
  static readonly template = 'password_reset';

  private constructor() {}

  static render(params: { name: string; link: string; expires_in_min: number }): RenderedMail {
    const expiry = `The link expires in ${params.expires_in_min} minutes and works once.`;
    const not_you = "If you didn't ask for this, ignore this email - your password stays as it is.";

    return {
      subject: 'Reset your Cortex password',
      text: [
        `Hi ${params.name},`,
        'Someone asked to reset the password for your Cortex account. Open this link to choose a new one:',
        params.link,
        expiry,
        not_you
      ].join('\n\n'),
      html: EmailLayout.wrap({
        title: 'Reset your password',
        preheader: expiry,
        body_html:
          EmailLayout.paragraph(`Hi ${params.name},`) +
          EmailLayout.paragraph('Someone asked to reset the password for your Cortex account.') +
          EmailLayout.button({ href: params.link, label: 'Choose a new password' }) +
          EmailLayout.paragraph(expiry) +
          EmailLayout.paragraph(not_you)
      })
    };
  }
}
