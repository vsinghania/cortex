/*
 * Google sign-in with in-memory stand-ins for Mongo and Google. GoogleAuthSvc,
 * SessionIssuer and the AuthSvc password check are the real code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleAuthSvc } from '../src/auth_svc/google_auth_svc.js';
import { GoogleOAuthConfigLoader } from '../src/auth_svc/config/google_oauth_config.js';
import { SessionIssuer } from '../src/auth_svc/session_issuer.js';
import { AuthSvc } from '../src/auth_svc/auth_svc.js';
import { TokenUtils } from '../src/auth_svc/utils/token_utils.js';
import type { GoogleOAuthAdapterInterface } from '../src/auth_svc/adapters/google_oauth_adapter_interface.js';
import type { GoogleIdentity } from '../src/auth_svc/types/google_auth.types.js';
import type { RefreshTokenRepository } from '../src/auth_svc/repositories/refresh_token_repository_interface.js';
import type { UserRepository } from '../src/user/repositories/user_repository_interface.js';
import type { CreateUserInput, UpdateUserPatch, User } from '../src/user/types/user.types.js';
import { UnauthorizedError } from '../src/common/errors.js';
import { Time } from '../src/lib/time.js';

process.env.JWT_ACCESS_SECRET = 'test-secret';

class InMemoryUserRepo implements UserRepository {
  constructor(readonly users: User[] = []) {}

  async createUser(input: CreateUserInput & { user_id: string }): Promise<User> {
    const user: User = { ...input, roles: input.roles ?? ['user'], created_at: new Date(), updated_at: new Date() };
    this.users.push(user);
    return user;
  }
  async findByUserId(user_id: string) {
    return this.users.find((u) => u.user_id === user_id) ?? null;
  }
  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email.toLowerCase().trim()) ?? null;
  }
  async findByGoogleSub(google_sub: string) {
    return this.users.find((u) => u.google_sub === google_sub) ?? null;
  }
  async updateByUserId(user_id: string, patch: UpdateUserPatch) {
    const user = await this.findByUserId(user_id);
    if (user) Object.assign(user, patch);
    return user;
  }
  async setLastLoginAt(user_id: string, at: Date) {
    const user = await this.findByUserId(user_id);
    if (user) user.last_login_at = at;
    return user;
  }
  async setEmailVerifiedAt(user_id: string, at: Date) {
    const user = await this.findByUserId(user_id);
    if (user) user.email_verified_at = at;
    return user;
  }
  async linkGoogleAccount(user_id: string, google_sub: string) {
    const user = await this.findByUserId(user_id);
    if (user) user.google_sub = google_sub;
    return user;
  }
  async removePassword(user_id: string) {
    const user = await this.findByUserId(user_id);
    if (user) delete user.password_hash;
    return user;
  }
}

class FakeGoogle implements GoogleOAuthAdapterInterface {
  last_challenge?: string;
  exchanged_with?: { code: string; code_verifier: string };

  constructor(private readonly identity: GoogleIdentity) {}

  buildAuthorizationUrl(params: { state: string; code_challenge: string }) {
    this.last_challenge = params.code_challenge;
    return `https://accounts.google.test/auth?state=${params.state}`;
  }

  async exchangeCode(params: { code: string; code_verifier: string }) {
    this.exchanged_with = params;
    return this.identity;
  }
}

class RecordingSessions {
  revoked_for: string[] = [];

  async createSession() {
    return undefined;
  }
  async revokeAllForUser(user_id: string) {
    this.revoked_for.push(user_id);
    return 2;
  }
}

function existingUser(overrides: Partial<User> = {}): User {
  return {
    user_id: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    password_hash: 'hash',
    roles: ['user'],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

async function buildSvc(user_repo: InMemoryUserRepo, google: FakeGoogle) {
  const sessions = new RecordingSessions();
  const rt_repo = sessions as unknown as RefreshTokenRepository;
  const svc = await GoogleAuthSvc.create({ user_repo, google, rt_repo, session_issuer: await SessionIssuer.create(rt_repo) });
  return { svc, sessions };
}

async function signIn(opts: { identity: GoogleIdentity; users?: User[]; return_to?: string }) {
  const user_repo = new InMemoryUserRepo(opts.users);
  const google = new FakeGoogle(opts.identity);
  const { svc, sessions } = await buildSvc(user_repo, google);
  const { pending } = svc.startAuthorization(opts.return_to);
  const result = await svc.completeAuthorization({ code: 'code-1', state: pending.state, pending });
  return { result, user_repo, google, pending, sessions };
}

const ADA: GoogleIdentity = { sub: 'g-ada', email: 'ada@example.com', email_verified: true, name: 'Ada L' };

test('a new Google account creates a verified user with no password', async () => {
  const { result, user_repo } = await signIn({ identity: ADA });
  assert.equal(user_repo.users.length, 1);
  const stored = user_repo.users[0];
  assert.equal(stored.google_sub, 'g-ada');
  assert.equal(stored.password_hash, undefined);
  assert.ok(stored.email_verified_at);
  assert.ok(result.tokens.access_token);
  assert.equal('google_sub' in result.user, false, 'the linked id never leaves the service');
});

test('the code exchange uses the verifier whose S256 challenge was sent to Google', async () => {
  const { google, pending } = await signIn({ identity: ADA });
  assert.equal(google.exchanged_with?.code_verifier, pending.code_verifier);
  assert.equal(google.last_challenge, TokenUtils.sha256Base64Url(pending.code_verifier));
});

test('a returning Google user signs into the same account', async () => {
  const users = [existingUser({ google_sub: 'g-ada', email: 'old@example.com' })];
  const { result, user_repo } = await signIn({ identity: ADA, users });
  assert.equal(result.user.user_id, 'user-1');
  assert.equal(user_repo.users.length, 1);
});

test('a verified Google email links a verified password account, which keeps its password and sessions', async () => {
  const verified_at = new Date(Date.now() - Time.daysToMs(3));
  const { result, user_repo, sessions } = await signIn({
    identity: ADA,
    users: [existingUser({ email_verified_at: verified_at })]
  });
  assert.equal(result.user.user_id, 'user-1');
  assert.equal(user_repo.users[0].google_sub, 'g-ada');
  assert.equal(user_repo.users[0].password_hash, 'hash', 'the password keeps working');
  assert.equal(user_repo.users[0].email_verified_at, verified_at);
  assert.deepEqual(sessions.revoked_for, []);
});

test('linking an unverified password account drops the unproven password and its sessions', async () => {
  // Someone registered Ada's address with their own password; Ada now signs in with Google.
  const { result, user_repo, sessions } = await signIn({ identity: ADA, users: [existingUser()] });
  assert.equal(result.user.user_id, 'user-1');
  assert.equal(user_repo.users[0].google_sub, 'g-ada');
  assert.equal(user_repo.users[0].password_hash, undefined, 'the squatter can no longer sign in');
  assert.ok(user_repo.users[0].email_verified_at);
  assert.deepEqual(sessions.revoked_for, ['user-1'], 'nor keep a session started with that password');
});

test('an unverified Google email never links or creates an account', async () => {
  const identity = { ...ADA, email_verified: false };
  await assert.rejects(signIn({ identity, users: [existingUser()] }), UnauthorizedError);
  await assert.rejects(signIn({ identity }), UnauthorizedError);
});

test('an account already linked to another Google account is not re-linked', async () => {
  const users = [existingUser({ google_sub: 'g-someone-else' })];
  await assert.rejects(signIn({ identity: ADA, users }), UnauthorizedError);
  assert.equal(users[0].google_sub, 'g-someone-else');
});

test('a callback whose state does not match the cookie is rejected before exchanging the code', async () => {
  const google = new FakeGoogle(ADA);
  const { svc } = await buildSvc(new InMemoryUserRepo(), google);
  const { pending } = svc.startAuthorization();
  await assert.rejects(
    svc.completeAuthorization({ code: 'code-1', state: 'forged', pending }),
    UnauthorizedError
  );
  assert.equal(google.exchanged_with, undefined);
});

test('return_to only accepts same-origin paths', async () => {
  assert.equal(GoogleAuthSvc.sanitizeReturnTo('/notes/abc?x=1'), '/notes/abc?x=1');
  for (const hostile of [undefined, '', '//evil.example', 'https://evil.example', '/\\evil.example', 'notes']) {
    assert.equal(GoogleAuthSvc.sanitizeReturnTo(hostile), '/notes', String(hostile));
  }
  const { result } = await signIn({ identity: ADA, return_to: '//evil.example' });
  assert.equal(result.return_to, '/notes');
});

test('password login on a Google-only account fails like a wrong password', async () => {
  const svc = await AuthSvc.create({
    user_repo: new InMemoryUserRepo([existingUser({ password_hash: undefined, google_sub: 'g-ada' })]),
    rt_repo: new RecordingSessions() as unknown as RefreshTokenRepository,
    email_verification: { requestVerification: async () => undefined }
  });
  await assert.rejects(svc.login({ email: 'ada@example.com', password: 'anything-at-all' }), /Invalid credentials/);
});

test('Google sign-in is enabled by the client credentials, which need a redirect URI', () => {
  assert.equal(GoogleOAuthConfigLoader.fromEnv({}), null);
  assert.equal(GoogleOAuthConfigLoader.fromEnv({ GOOGLE_OAUTH_CLIENT_ID: '' }), null);
  assert.equal(GoogleOAuthConfigLoader.fromEnv({ GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/cb' }), null);
  assert.throws(() => GoogleOAuthConfigLoader.fromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'id' }));
  assert.throws(() =>
    GoogleOAuthConfigLoader.fromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' })
  );
  assert.deepEqual(
    GoogleOAuthConfigLoader.fromEnv({
      GOOGLE_OAUTH_CLIENT_ID: 'id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/google/callback'
    }),
    { client_id: 'id', client_secret: 'secret', redirect_uri: 'http://localhost:3000/api/v1/auth/google/callback' }
  );
});
