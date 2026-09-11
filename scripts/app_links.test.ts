import assert from 'node:assert/strict';
import test from 'node:test';
import { AppLinks } from '../src/auth_svc/app_links.js';

test('the reset token rides in the fragment, never the query string', () => {
  const link = AppLinks.fromEnv({ APP_PUBLIC_URL: 'https://cortexapp.me' }).passwordReset('abc-_123');
  assert.equal(link, 'https://cortexapp.me/reset-password#token=abc-_123');
  assert.equal(new URL(link).search, '');
});

test('a trailing slash on the origin does not double up', () => {
  const link = AppLinks.fromEnv({ APP_PUBLIC_URL: 'http://localhost:5173/' }).passwordReset('t');
  assert.equal(link, 'http://localhost:5173/reset-password#token=t');
});

test('a missing or relative APP_PUBLIC_URL is rejected', () => {
  assert.throws(() => AppLinks.fromEnv({}), /APP_PUBLIC_URL/);
  assert.throws(() => AppLinks.fromEnv({ APP_PUBLIC_URL: 'cortexapp.me' }), /APP_PUBLIC_URL/);
});
