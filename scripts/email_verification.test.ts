/*
 * The email-verification flow end to end, with in-memory stand-ins for Mongo, the job
 * queue and the mail relay. Everything between them - EmailVerificationSvc, AuthSvc.register,
 * EmailVerificationEmailJobHandler, EmailTokenSender, EmailTokenIssuer, AppLinks and the
 * template - is the real code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailVerificationSvc } from '../src/auth_svc/email_verification_svc.js';
import { EmailVerificationEmailJobHandler } from '../src/auth_svc/jobs/email_verification_email_job_handler.js';
import { AuthSvc } from '../src/auth_svc/auth_svc.js';
import { EmailTokenSender } from '../src/auth_svc/emails/email_token_sender.js';
import { AuthJobName } from '../src/auth_svc/jobs/auth_job.types.js';
import { EmailTokenIssuer } from '../src/auth_svc/email_token_issuer.js';
import { AppLinks } from '../src/auth_svc/app_links.js';
import type { EmailTokenRepository } from '../src/auth_svc/repositories/email_token_repository_interface.js';
import type { RefreshTokenRepository } from '../src/auth_svc/repositories/refresh_token_repository_interface.js';
import type { EmailToken, EmailTokenPurpose } from '../src/auth_svc/types/email_token.types.js';
import type { UserRepository } from '../src/user/repositories/user_repository_interface.js';
import type { CreateUserInput, UpdateUserPatch, User } from '../src/user/types/user.types.js';
import type { MailerSvcInterface } from '../src/mailer_svc/mailer_svc_interface.js';
import type { MailMessage } from '../src/mailer_svc/types/mail.types.js';
import { MailDeliveryError } from '../src/mailer_svc/mail_delivery_error.js';
import type { EnqueueInput } from '../src/jobs_svc/types/job.types.js';
import { PermanentJobError } from '../src/jobs_svc/job_errors.js';
import { BadRequestError, ConflictError } from '../src/common/errors.js';
import { Time } from '../src/lib/time.js';

class InMemoryEmailTokenRepo implements EmailTokenRepository {
  rows: EmailToken[] = [];

  async replaceForUser(input: { user_id: string; purpose: EmailTokenPurpose; token_hash: string; expires_at: Date }) {
    this.rows = this.rows.filter((r) => !(r.user_id === input.user_id && r.purpose === input.purpose));
    this.rows.push({ ...input, created_at: new Date(), updated_at: new Date() });
  }

  async consume(input: { token_hash: string; purpose: EmailTokenPurpose; now: Date }) {
    const row = this.rows.find(
      (r) => r.token_hash === input.token_hash && r.purpose === input.purpose && !r.consumed_at && r.expires_at > input.now
    );
    if (!row) return null;
    row.consumed_at = input.now;
    return row;
  }
}

class InMemoryUserRepo implements UserRepository {
  constructor(readonly users: User[]) {}

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
  async findByGoogleSub(google_sub: string) {
    return this.users.find((u) => u.google_sub === google_sub) ?? null;
  }
  async linkGoogleAccount(user_id: string, google_sub: string) {
    const user = await this.findByUserId(user_id);
    if (user) user.google_sub = google_sub;
    return user;
  }
}

class RecordingMailer implements MailerSvcInterface {
  sent: MailMessage[] = [];
  constructor(private readonly failure?: MailDeliveryError) {}

  async send(message: MailMessage) {
    if (this.failure) throw this.failure;
    this.sent.push(message);
    return { message_id: `<m${this.sent.length}@test>` };
  }
  async verify() {}
}

class RecordingJobs {
  enqueued: EnqueueInput[] = [];
  constructor(private readonly conflict = false) {}

  async enqueue(input: EnqueueInput) {
    if (this.conflict) throw new ConflictError('An email_verification_email job is already active');
    this.enqueued.push(input);
    return { job_id: `job-${this.enqueued.length}`, created: true };
  }
}

type Harness = Awaited<ReturnType<typeof buildHarness>>;

async function buildHarness(opts: { mail_failure?: MailDeliveryError; enqueue_conflict?: boolean; verified?: boolean } = {}) {
  const user: User = {
    user_id: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    password_hash: 'irrelevant-here',
    roles: ['user'],
    created_at: new Date(),
    updated_at: new Date(),
    email_verified_at: opts.verified ? new Date() : undefined
  };
  const user_repo = new InMemoryUserRepo([user]);
  const token_repo = new InMemoryEmailTokenRepo();
  const token_issuer = await EmailTokenIssuer.create({ repo: token_repo });
  const mailer = new RecordingMailer(opts.mail_failure);
  const jobs = new RecordingJobs(opts.enqueue_conflict);

  const sender = await EmailTokenSender.create({
    user_repo,
    token_issuer,
    mailer: () => mailer,
    links: () => AppLinks.fromEnv({ APP_PUBLIC_URL: 'https://app.test' })
  });
  const handler = await EmailVerificationEmailJobHandler.create({ sender });
  const svc = await EmailVerificationSvc.create({ user_repo, token_issuer, jobs });

  return { user, user_repo, token_repo, token_issuer, mailer, jobs, handler, svc };
}

/** Plays the worker: runs the handler on whatever the service enqueued. */
async function deliverQueued(h: Harness) {
  const job = h.jobs.enqueued.at(-1)!;
  return h.handler.handle(h.handler.parsePayload(job.payload));
}

function tokenFromLastEmail(h: Harness): string {
  const link = h.mailer.sent.at(-1)!.text.match(/https:\/\/\S+/)![0];
  return new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;
}

test('a request enqueues a single-flight, deadlined job carrying only the user id', async () => {
  const h = await buildHarness();
  await h.svc.requestVerification('user-1');

  assert.equal(h.jobs.enqueued.length, 1);
  const job = h.jobs.enqueued[0];
  assert.equal(job.name, AuthJobName.EmailVerificationEmail);
  assert.deepEqual(job.payload, { user_id: 'user-1' }, 'no token or email may ride on the job');
  assert.equal(job.user_id, 'user-1');
  assert.ok(job.dedup_key);
  assert.ok(job.deadline_at && job.deadline_at.getTime() > Date.now());
});

test('an already-verified user enqueues nothing', async () => {
  const h = await buildHarness({ verified: true });
  await h.svc.requestVerification('user-1');
  assert.equal(h.jobs.enqueued.length, 0);
});

test('an unknown user enqueues nothing', async () => {
  const h = await buildHarness();
  await h.svc.requestVerification('nobody');
  assert.equal(h.jobs.enqueued.length, 0);
});

test('a request while a send is already in flight is a quiet no-op', async () => {
  const h = await buildHarness({ enqueue_conflict: true });
  await assert.doesNotReject(h.svc.requestVerification('user-1'));
});

test('the delivered email goes to the user and links to the SPA with the token in the fragment', async () => {
  const h = await buildHarness();
  await h.svc.requestVerification('user-1');
  const result = await deliverQueued(h);

  assert.deepEqual(result, { outcome: 'succeeded', summary: { message_id: '<m1@test>' } });
  const mail = h.mailer.sent[0];
  assert.equal(mail.to, 'ada@example.com');
  assert.equal(mail.template, 'email_verification');
  assert.match(mail.text, /https:\/\/app\.test\/verify-email#token=[\w-]+/);
  assert.equal(h.token_repo.rows[0].token_hash.includes(tokenFromLastEmail(h)), false, 'only the hash is stored');
});

test('the full flow marks the user verified, and the link works once', async () => {
  const h = await buildHarness();
  await h.svc.requestVerification('user-1');
  await deliverQueued(h);
  const token = tokenFromLastEmail(h);

  await h.svc.verify(token);

  assert.ok(h.user.email_verified_at);
  await assert.rejects(h.svc.verify(token), BadRequestError);
});

test('a newer email invalidates the older link', async () => {
  const h = await buildHarness();
  await h.svc.requestVerification('user-1');
  await deliverQueued(h);
  const first = tokenFromLastEmail(h);
  await deliverQueued(h);
  const second = tokenFromLastEmail(h);

  await assert.rejects(h.svc.verify(first), BadRequestError);
  await assert.doesNotReject(h.svc.verify(second));
});

test('an expired token is rejected even if the TTL reaper has not removed it yet', async () => {
  const h = await buildHarness();
  const issued_at = new Date(Date.now() - EmailTokenIssuer.ttlMs('email_verification') - Time.secondsToMs(1));
  const { token } = await h.token_issuer.issue({ user_id: 'user-1', purpose: 'email_verification', now: issued_at });

  await assert.rejects(h.svc.verify(token), BadRequestError);
  assert.equal(h.user.email_verified_at, undefined);
});

test('a reset token cannot be redeemed as a verification token', async () => {
  const h = await buildHarness();
  const { token } = await h.token_issuer.issue({ user_id: 'user-1', purpose: 'password_reset' });

  await assert.rejects(h.svc.verify(token), BadRequestError);
  assert.equal(h.user.email_verified_at, undefined);
});

test('a garbage token is rejected without verifying anyone', async () => {
  const h = await buildHarness();
  await assert.rejects(h.svc.verify('not-a-token'), BadRequestError);
  assert.equal(h.user.email_verified_at, undefined);
});

test('a deleted user fails the job permanently rather than retrying', async () => {
  const h = await buildHarness();
  await assert.rejects(h.handler.handle({ user_id: 'gone' }), PermanentJobError);
});

test('a relay failure is reported with the relay retryability', async () => {
  const transient = await buildHarness({
    mail_failure: new MailDeliveryError({ error_code: 'ETIMEDOUT', retryable: true })
  });
  const refused = await buildHarness({
    mail_failure: new MailDeliveryError({ error_code: 'EENVELOPE', response_code: 550, retryable: false })
  });

  const transient_result = await transient.handler.handle({ user_id: 'user-1' });
  const refused_result = await refused.handler.handle({ user_id: 'user-1' });
  assert.equal(transient_result.outcome === 'failed' && transient_result.retryable, true);
  assert.equal(refused_result.outcome === 'failed' && refused_result.retryable, false);
});

test('the payload schema refuses anything beyond the user id', async () => {
  const h = await buildHarness();
  assert.throws(() => h.handler.parsePayload({ user_id: 'user-1', token: 'leaked' }));
  assert.throws(() => h.handler.parsePayload({}));
});

test('registering asks for a verification email, and a queue failure does not fail the registration', async () => {
  // register() signs an access token; TokenUtils reads the secret per call.
  process.env.JWT_ACCESS_SECRET = 'test-secret';
  const user_repo = new InMemoryUserRepo([]);
  const rt_repo = { createSession: async () => undefined } as unknown as RefreshTokenRepository;
  const requested: string[] = [];

  const svc = await AuthSvc.create({
    user_repo,
    rt_repo,
    email_verification: {
      requestVerification: async (user_id: string) => {
        requested.push(user_id);
      }
    }
  });
  const result = await svc.register({ email: 'Grace@example.com', name: 'Grace', password: 'a-password' });
  assert.deepEqual(requested, [result.user.user_id]);
  assert.equal(result.user.email_verified_at, undefined, 'a new account starts unverified');

  const failing = await AuthSvc.create({
    user_repo: new InMemoryUserRepo([]),
    rt_repo,
    email_verification: {
      requestVerification: async () => {
        throw new Error('queue is down');
      }
    }
  });
  await assert.doesNotReject(failing.register({ email: 'ada@example.com', name: 'Ada', password: 'a-password' }));
});
