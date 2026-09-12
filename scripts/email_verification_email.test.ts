import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailVerificationEmail } from '../src/auth_svc/emails/email_verification_email.js';

const LINK = 'https://app.test/verify-email#token=abc123';

test('both parts carry the link and the expiry', () => {
  const mail = EmailVerificationEmail.render({ name: 'Ada', link: LINK, expires_in_hours: 24 });
  assert.ok(mail.text.includes(LINK));
  assert.ok(mail.html.includes(`href="${LINK}"`));
  assert.ok(mail.text.includes('24 hours'));
  assert.ok(mail.html.includes('24 hours'));
});

test('the name is escaped in HTML and kept literal in text', () => {
  const mail = EmailVerificationEmail.render({ name: '<Eve & co>', link: LINK, expires_in_hours: 24 });
  assert.ok(mail.html.includes('Hi &lt;Eve &amp; co&gt;,'));
  assert.equal(mail.html.includes('<Eve'), false);
  assert.ok(mail.text.startsWith('Hi <Eve & co>,'));
});
