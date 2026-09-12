import type { RenderedMail } from '../../mailer_svc/types/mail.types.js';
import { EmailLayout } from '../../mailer_svc/templates/email_layout.js';

export class EmailVerificationEmail {
  static readonly template = 'email_verification';

  private constructor() {}

  static render(params: { name: string; link: string; expires_in_hours: number }): RenderedMail {
    // The honest reason to bother: enforcement is soft, so nothing breaks while
    // unverified - but a reset link can only reach an address we know is real.
    const why = 'Confirming your address is what keeps your account recoverable: it is where a password reset link would go if you ever lose your way in.';
    const expiry = `The link expires in ${params.expires_in_hours} hours and can only be used once. If it lapses before you get to it, you can ask for a fresh one from the banner inside Cortex.`;
    const not_you = "If you didn't sign up for Cortex, there is nothing to do - ignore this email and the link will quietly expire on its own.";

    return {
      subject: 'Confirm your email address for Cortex',
      text: [
        `Hi ${params.name},`,
        why,
        'Confirm your address here:',
        params.link,
        expiry,
        not_you
      ].join('\n\n'),
      html: EmailLayout.wrap({
        title: 'Confirm your email address',
        preheader: 'One click keeps your Cortex account recoverable.',
        body_html:
          EmailLayout.paragraph(`Hi ${params.name},`) +
          EmailLayout.paragraph(why) +
          EmailLayout.button({ href: params.link, label: 'Confirm my email address' }) +
          EmailLayout.paragraph(expiry) +
          EmailLayout.paragraph(not_you)
      })
    };
  }
}
