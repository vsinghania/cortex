import assert from 'node:assert/strict';
import test from 'node:test';
import { MailerConfigLoader } from '../src/mailer_svc/config/mailer_config.js';

const MINIMAL_ENV = { MAIL_FROM: 'Cortex <no-reply@example.com>', SMTP_HOST: 'smtp.example.com' };

test('minimal env gets STARTTLS-style defaults and no auth', () => {
  const config = MailerConfigLoader.fromEnv(MINIMAL_ENV);
  assert.equal(config.transport, 'smtp');
  assert.equal(config.from, MINIMAL_ENV.MAIL_FROM);
  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.secure, false);
  assert.equal(config.smtp.auth, undefined);
});

test('port 465 implies implicit TLS unless SMTP_SECURE says otherwise', () => {
  assert.equal(MailerConfigLoader.fromEnv({ ...MINIMAL_ENV, SMTP_PORT: '465' }).smtp.secure, true);
  assert.equal(
    MailerConfigLoader.fromEnv({ ...MINIMAL_ENV, SMTP_PORT: '465', SMTP_SECURE: 'false' }).smtp.secure,
    false
  );
});

test('credentials are passed through when both are set', () => {
  const config = MailerConfigLoader.fromEnv({ ...MINIMAL_ENV, SMTP_USER: 'u', SMTP_PASS: 'p' });
  assert.deepEqual(config.smtp.auth, { user: 'u', pass: 'p' });
});

test('empty strings from compose interpolation count as unset', () => {
  const config = MailerConfigLoader.fromEnv({
    ...MINIMAL_ENV,
    MAIL_TRANSPORT: '',
    SMTP_PORT: '',
    SMTP_SECURE: '',
    SMTP_USER: '',
    SMTP_PASS: ''
  });
  assert.equal(config.transport, 'smtp');
  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.auth, undefined);
});

test('missing SMTP_HOST or MAIL_FROM is rejected', () => {
  assert.throws(() => MailerConfigLoader.fromEnv({ MAIL_FROM: MINIMAL_ENV.MAIL_FROM }));
  assert.throws(() => MailerConfigLoader.fromEnv({ SMTP_HOST: MINIMAL_ENV.SMTP_HOST }));
});

test('a user without a password is rejected', () => {
  assert.throws(() => MailerConfigLoader.fromEnv({ ...MINIMAL_ENV, SMTP_USER: 'u' }), /set together/);
});

test('an unknown transport or a bad port is rejected', () => {
  assert.throws(() => MailerConfigLoader.fromEnv({ ...MINIMAL_ENV, MAIL_TRANSPORT: 'carrier_pigeon' }));
  assert.throws(() => MailerConfigLoader.fromEnv({ ...MINIMAL_ENV, SMTP_PORT: 'abc' }));
});
