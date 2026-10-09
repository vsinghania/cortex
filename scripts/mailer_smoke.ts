import 'dotenv/config';
import { MailerSvc } from '../src/mailer_svc/mailer_svc.js';
import { EmailLayout } from '../src/mailer_svc/templates/email_layout.js';

// Mailpit accepts any recipient, so the default is safe to send to locally.
const DEFAULT_TO = 'smoke@example.com';

async function main(): Promise<void> {
  const to = process.argv[2] ?? DEFAULT_TO;
  const mailer = MailerSvc.getInstance();

  await mailer.verifyTransportConnection();
  console.log('  ok   transport verified');

  const result = await mailer.sendMail({
    to,
    template: 'mailer_smoke',
    subject: 'Cortex mailer smoke test',
    text: 'If you can read this, the Cortex mailer is delivering.',
    html: EmailLayout.wrap({
      title: 'Mailer smoke test',
      preheader: 'The Cortex mailer is delivering.',
      body_html:
        EmailLayout.paragraph('If you can read this, the Cortex mailer is delivering.') +
        EmailLayout.button({ href: 'https://example.com', label: 'A sample button' })
    })
  });
  console.log(`  ok   sent (message_id=${result.message_id})`);
}

main().catch((err) => {
  console.error(`  FAIL ${(err as Error).message}`);
  process.exit(1);
});
