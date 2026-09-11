import assert from 'node:assert/strict';
import test from 'node:test';
import { SmtpErrorClassifier } from '../src/mailer_svc/transports/smtp_error_classifier.js';
import { MailDeliveryError } from '../src/mailer_svc/mail_delivery_error.js';

function smtpError(fields: { code?: string; responseCode?: number; message?: string; response?: string }): Error {
  return Object.assign(new Error(fields.message ?? 'smtp failure'), fields);
}

test('a 5xx reply is permanent and keeps its reply code', () => {
  const classified = SmtpErrorClassifier.classify(smtpError({ code: 'EENVELOPE', responseCode: 550 }));
  assert.equal(classified.retryable, false);
  assert.equal(classified.response_code, 550);
  assert.equal(classified.error_code, 'EENVELOPE');
});

test('a 4xx reply is retryable', () => {
  const classified = SmtpErrorClassifier.classify(smtpError({ code: 'EMESSAGE', responseCode: 451 }));
  assert.equal(classified.retryable, true);
});

test('the reply code outranks the error code', () => {
  const rejected_login = SmtpErrorClassifier.classify(smtpError({ code: 'EAUTH', responseCode: 535 }));
  const auth_unavailable = SmtpErrorClassifier.classify(smtpError({ code: 'EAUTH', responseCode: 454 }));
  assert.equal(rejected_login.retryable, false);
  assert.equal(auth_unavailable.retryable, true);
});

test('transport-level failures without a reply are retryable', () => {
  for (const code of ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS']) {
    assert.equal(SmtpErrorClassifier.classify(smtpError({ code })).retryable, true, code);
  }
});

test('envelope, message and config errors without a reply are permanent', () => {
  for (const code of ['EENVELOPE', 'EMESSAGE', 'EAUTH', 'ENOAUTH', 'ECONFIG']) {
    assert.equal(SmtpErrorClassifier.classify(smtpError({ code })).retryable, false, code);
  }
});

test('an unrecognized throw is retryable with an unknown code', () => {
  const classified = SmtpErrorClassifier.classify('boom');
  assert.equal(classified.retryable, true);
  assert.equal(classified.error_code, 'unknown');
});

test('the message never carries the server text or the recipient', () => {
  const classified = SmtpErrorClassifier.classify(
    smtpError({
      code: 'EENVELOPE',
      responseCode: 550,
      message: "Can't send mail - all recipients were rejected: 550 <alice@example.com> no such user",
      response: '550 5.1.1 <alice@example.com> no such user'
    })
  );
  assert.equal(classified.message.includes('alice'), false);
  assert.equal(classified.cause, undefined);
});

test('an already-classified error passes through unchanged', () => {
  const original = new MailDeliveryError({ error_code: 'recipient_rejected', retryable: false });
  assert.equal(SmtpErrorClassifier.classify(original), original);
});
