/*
 * AuthSvc.sessionUserId: the read-only session lookup an OAuth callback uses to learn
 * who the browser is signed in as. Refresh sessions live in memory here; the hashing
 * and the validity rules are the real code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthSvc } from '../src/auth_svc/auth_svc.js';
import { TokenUtils } from '../src/auth_svc/utils/token_utils.js';
import type { RefreshSession } from '../src/auth_svc/types/auth.types.js';
import type { RefreshTokenRepository } from '../src/auth_svc/repositories/refresh_token_repository_interface.js';
import type { UserRepository } from '../src/user/repositories/user_repository_interface.js';

process.env.JWT_ACCESS_SECRET = 'test-secret';

const HOUR_MS = 60 * 60 * 1000;

function session(token: string, overrides: Partial<RefreshSession> = {}): RefreshSession {
  return {
    user_id: 'user-1',
    token_hash: TokenUtils.sha256Base64Url(token),
    expires_at: new Date(Date.now() + HOUR_MS),
    ...overrides
  } as RefreshSession;
}

async function svcWith(sessions: RefreshSession[]) {
  let rotations = 0;
  const rt_repo = {
    findByTokenHash: async (token_hash: string) => sessions.find((s) => s.token_hash === token_hash) ?? null,
    rotateSession: async () => {
      rotations += 1;
      return null;
    }
  } as unknown as RefreshTokenRepository;

  const svc = await AuthSvc.create({
    user_repo: {} as UserRepository,
    rt_repo,
    email_verification: { requestVerification: async () => undefined }
  });
  return { svc, rotations: () => rotations };
}

test('a live session resolves to its user, without rotating the token', async () => {
  const { svc, rotations } = await svcWith([session('live-token')]);

  assert.equal(await svc.sessionUserId('live-token'), 'user-1');
  assert.equal(rotations(), 0, 'a lookup must not spend the refresh token');
});

test('no cookie, an unknown token, a revoked or an expired session all resolve to nobody', async () => {
  const { svc } = await svcWith([
    session('revoked-token', { revoked_at: new Date() }),
    session('expired-token', { expires_at: new Date(Date.now() - HOUR_MS) })
  ]);

  assert.equal(await svc.sessionUserId(undefined), null);
  assert.equal(await svc.sessionUserId(''), null);
  assert.equal(await svc.sessionUserId('unknown-token'), null);
  assert.equal(await svc.sessionUserId('revoked-token'), null);
  assert.equal(await svc.sessionUserId('expired-token'), null);
});
