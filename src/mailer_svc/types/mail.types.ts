export type MailTransportKind = 'smtp';

/** What a domain-owned template produces. */
export type RenderedMail = {
  subject: string;
  text: string;
  html: string;
};

export type MailMessage = RenderedMail & {
  to: string;
  /**
   * Stable name for the kind of email (e.g. 'password_reset'). Logged in place of
   * the subject or recipient, which must never reach the logs.
   */
  template: string;
};

export type OutboundMail = MailMessage & { from: string };

export type MailSendResult = { message_id: string };
