/*
 * SecretBox against the real node crypto - there is nothing worth faking here, and
 * the properties under test (tamper detection, context binding, key rotation) only
 * mean anything against the real cipher.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SecretBox, type SecretAad } from '../src/lib/crypto/secret_box.js';

const KEY_A = Buffer.alloc(32, 0xa1).toString('base64');
const KEY_B = Buffer.alloc(32, 0xb2).toString('base64');

const AAD: SecretAad = { user_id: 'user-1', field: 'token_cache' };

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    SECRET_ENCRYPTION_KEYS: `k1:${KEY_A}`,
    SECRET_ENCRYPTION_ACTIVE_KEY_ID: 'k1',
    ...overrides
  };
}

/** Swaps one base64url part of a sealed value for a corrupted one of the same length. */
function corruptPart(sealed: string, index: number): string {
  const parts = sealed.split('.');
  const bytes = Buffer.from(parts[index], 'base64url');
  bytes[0] ^= 0xff;
  parts[index] = bytes.toString('base64url');
  return parts.join('.');
}

test('a sealed value round-trips and does not carry the plaintext', () => {
  const box = SecretBox.fromEnv(env());
  const sealed = box.seal('a-refresh-token', AAD);

  assert.equal(box.open(sealed, AAD), 'a-refresh-token');
  assert.equal(sealed.includes('a-refresh-token'), false);
  assert.equal(sealed.split('.').length, 4);
  assert.equal(sealed.split('.')[0], 'k1', 'the key id leads, so rotation can find old rows');
});

test('sealing the same plaintext twice gives different ciphertexts', () => {
  const box = SecretBox.fromEnv(env());
  assert.notEqual(box.seal('same', AAD), box.seal('same', AAD));
});

test('a tampered key id, iv, auth tag or ciphertext all fail to open', () => {
  const box = SecretBox.fromEnv(env());
  const sealed = box.seal('a-refresh-token', AAD);

  for (const index of [1, 2, 3]) {
    assert.throws(() => box.open(corruptPart(sealed, index), AAD), /failed authentication|malformed/);
  }
  assert.throws(() => box.open(sealed.replace(/^k1\./, 'k9.'), AAD), /No key with id "k9"/);
  assert.throws(() => box.open('not-a-sealed-value', AAD), /malformed/);
});

test('opening with a different user or field fails', () => {
  const box = SecretBox.fromEnv(env());
  const sealed = box.seal('a-refresh-token', AAD);

  assert.throws(() => box.open(sealed, { ...AAD, user_id: 'user-2' }), /failed authentication/);
  assert.throws(() => box.open(sealed, { ...AAD, field: 'other_column' }), /failed authentication/);
});

test('context encoding cannot be made ambiguous by a shifted boundary', () => {
  const box = SecretBox.fromEnv(env());
  const sealed = box.seal('a-refresh-token', { user_id: 'ab', field: 'c' });

  assert.throws(() => box.open(sealed, { user_id: 'a', field: 'bc' }), /failed authentication/);
});

test('a retired key still opens old values while writes use the active key', () => {
  const old_box = SecretBox.fromEnv(env({ SECRET_ENCRYPTION_KEYS: `k1:${KEY_A}` }));
  const sealed_with_old = old_box.seal('a-refresh-token', AAD);

  const rotated = SecretBox.fromEnv(
    env({ SECRET_ENCRYPTION_KEYS: `k1:${KEY_A},k2:${KEY_B}`, SECRET_ENCRYPTION_ACTIVE_KEY_ID: 'k2' })
  );

  assert.equal(rotated.open(sealed_with_old, AAD), 'a-refresh-token', 'no big-bang migration needed');
  assert.equal(rotated.seal('fresh', AAD).split('.')[0], 'k2', 'new writes move to the active key');
});

test('a value sealed under a key that is no longer loaded fails loudly', () => {
  const sealed = SecretBox.fromEnv(
    env({ SECRET_ENCRYPTION_KEYS: `k2:${KEY_B}`, SECRET_ENCRYPTION_ACTIVE_KEY_ID: 'k2' })
  ).seal('a-refresh-token', AAD);

  assert.throws(() => SecretBox.fromEnv(env()).open(sealed, AAD), /No key with id "k2"/);
});

test('misconfiguration throws at construction rather than at first use', () => {
  assert.throws(() => SecretBox.fromEnv(env({ SECRET_ENCRYPTION_KEYS: '' })), /is not set/);
  assert.throws(() => SecretBox.fromEnv(env({ SECRET_ENCRYPTION_ACTIVE_KEY_ID: '' })), /is not set/);
  assert.throws(() => SecretBox.fromEnv(env({ SECRET_ENCRYPTION_ACTIVE_KEY_ID: 'k9' })), /not among the keys/);

  const short_key = Buffer.alloc(16, 0xa1).toString('base64');
  assert.throws(() => SecretBox.fromEnv(env({ SECRET_ENCRYPTION_KEYS: `k1:${short_key}` })), /must decode to 32 bytes/);
  assert.throws(() => SecretBox.fromEnv(env({ SECRET_ENCRYPTION_KEYS: KEY_A })), /<key_id>:<base64 key>/);
  assert.throws(() => SecretBox.fromEnv(env({ SECRET_ENCRYPTION_KEYS: `k.1:${KEY_A}` })), /must match/);
  assert.throws(
    () => SecretBox.fromEnv(env({ SECRET_ENCRYPTION_KEYS: `k1:${KEY_A},k1:${KEY_B}` })),
    /appears twice/
  );
});

test('isConfigured gates the feature without throwing', () => {
  assert.equal(SecretBox.isConfigured(env()), true);
  assert.equal(SecretBox.isConfigured({}), false);
  assert.equal(SecretBox.isConfigured(env({ SECRET_ENCRYPTION_KEYS: '  ' })), false);
});
