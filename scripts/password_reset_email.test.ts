import assert from 'node:assert/strict';
import test from 'node:test';
import { PasswordResetEmail } from '../src/auth_svc/emails/password_reset_email.js';

const LINK = 'https://app.test/reset-password#token=abc123';

test('both parts carry the link and the expiry', () => {
  const mail = PasswordResetEmail.render({ name: 'Ada', link: LINK, expires_in_min: 30 });
  assert.ok(mail.text.includes(LINK));
  assert.ok(mail.html.includes(`href="${LINK}"`));
  assert.ok(mail.text.includes('30 minutes'));
  assert.ok(mail.html.includes('30 minutes'));
});

test('the name is escaped in HTML and kept literal in text', () => {
  const mail = PasswordResetEmail.render({ name: '<Eve & co>', link: LINK, expires_in_min: 30 });
  assert.ok(mail.html.includes('Hi &lt;Eve &amp; co&gt;,'));
  assert.equal(mail.html.includes('<Eve'), false);
  assert.ok(mail.text.startsWith('Hi <Eve & co>,'));
});
