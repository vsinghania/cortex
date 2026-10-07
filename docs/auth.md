# auth

Registration, login (password or Google), session refresh, logout, password reset. Issues the JWT every other route trusts, and owns the rotating refresh sessions behind it.

Source: [src/auth_svc/](../src/auth_svc/) (flows + session store) and [src/user/](../src/user/) (the `User` entity). Contract: `AuthSvcInterface` — `register`, `login`, `refresh`, `logout`, `getMe`, each taking an optional `{ ip, user_agent }` recorded on the session. Password reset is `PasswordResetSvcInterface` — `requestReset`, `resetPassword`. Email verification is `EmailVerificationSvcInterface` — `requestVerification`, `verify`. Google sign-in is `GoogleAuthSvcInterface` — `startAuthorization`, `completeAuthorization`.

---

## 1. The token model

Two tokens with deliberately different properties:

| | Access token | Refresh token |
| --- | --- | --- |
| Form | JWT, HS256, `JWT_ACCESS_SECRET` | opaque random bytes |
| Lifetime | 15 min default | 7 days default |
| Storage | none — stateless claims `{ sub, roles }` | **hashed** (SHA-256) as a session row |
| Transport | `Authorization: Bearer` | HttpOnly cookie (`rt`) |
| Verified by | middleware, no DB read | a lookup by hash on `/auth/refresh` |

- **The refresh token never appears in a response body.** The controller sets the cookie and returns only the access token, so the plaintext exists solely in the cookie while the database holds a hash — a database leak yields no usable sessions.
- **Every refresh rotates both tokens.** `rotateSession` swaps the stored hash atomically; a rotation that matches nothing throws `UnauthorizedError`, which is the reuse-detection seam.
- **Login failures are indistinguishable.** Unknown email and bad password both return `Invalid credentials`.
- **`SessionIssuer.toPublicUser` strips `password_hash` and `google_sub`** on every path out of the service. `SessionIssuer.issue` is the one place a session is started, whether the user proved themselves with a password or with Google.

## 2. How the rest of the system consumes it

Enforcement lives in middleware, not in this service: `requireAuth` verifies the bearer token and populates `req.auth` and the trace context; `authorizeRoles('admin')` gates agent create/update. Details in [platform.md](platform.md).

Verification is stateless, which has one important consequence: **revoking a refresh session does not invalidate an outstanding access token** — it simply stops working within 15 minutes.

Third-party access (ChatGPT, Claude) does not use these tokens at all: it gets its own opaque, revocable, resource-bound tokens from the OAuth authorization server in [oauth.md](oauth.md). The SPA's JWT is what proves who is consenting.

## 3. Password reset

```
POST /auth/password/forgot {email}                                         → 202, always
  └► PasswordResetSvc.requestReset ─► enqueue password_reset_email { user_id }
                                                   │ worker
     PasswordResetEmailJobHandler ─► issue token ─► render ─► MailerSvc ─► email: /reset-password#token=…

POST /auth/password/reset {token, password}                                → 200
  └► consume token ─► bcrypt new hash ─► revoke every refresh session
```

- **`forgot` answers 202 whether or not the account exists**, and the SPA words its confirmation for both cases, so the endpoint cannot be used to learn which emails are registered. It sits behind a second, stricter limiter (`EMAIL_SEND_RATE_LIMIT_*`, default 5 per 15 min per IP) on top of the auth one.
- **The token never touches a job row.** Admins can list job payloads, so the job carries `{ user_id }` only and the handler mints the token at send time. A retry after a failed send mints a new one — harmless, since the failed email never arrived.
- **Tokens are hashed, single-use and short-lived.** `email_tokens` (auth db) stores the SHA-256, never the token; rows expire after 30 minutes and a TTL index reaps them. `consume` is one conditional update, so a link cannot be used twice even by two simultaneous submissions. Issuing deletes the user's previous token, so only the newest email works.
- **One send in flight per user.** The job's dedup key turns a second `forgot` while one is queued into a no-op, rather than a second email whose token would invalidate the first. `deadline_at` drops a send the worker cannot start within 30 minutes.
- **A reset logs out every session** (`revokeAllForUser`) and clears the browser's refresh cookie. Access tokens already issued keep working until they expire (≤ 15 min), because verification is stateless (§2).
- **Links need `APP_PUBLIC_URL`**, the SPA origin. The token travels in the URL fragment, which browsers never send to a server, so it stays out of CloudFront and ALB logs and out of Referer headers; the reset page strips it from the address bar once read.

Delivery mechanics — transport, retries, what never gets logged — are in [mailer_svc.md](mailer_svc.md).

## 4. Email verification

```
POST /auth/register                                                        → 201
  └► AuthSvc.register ─► EmailVerificationSvc.requestVerification (best effort)

POST /auth/email/verify/resend        (requireAuth)                        → 202
  └► EmailVerificationSvc.requestVerification ─► enqueue email_verification_email { user_id }
                                                   │ worker
     EmailVerificationEmailJobHandler ─► issue token ─► render ─► MailerSvc ─► email: /verify-email#token=…

POST /auth/email/verify {token}                                            → 200
  └► consume token ─► set User.email_verified_at
```

Reuses every piece of the reset machinery in §3 — the same `email_tokens` collection, hashing, single-use `consume`, dedup key and fragment-borne link — with `purpose: 'email_verification'` telling them apart. A token minted for one purpose cannot be redeemed for the other.

- **Enforcement is soft.** An unverified user keeps full access; the SPA shows a banner with a Resend button and nothing else changes. Users created before this existed have no `email_verified_at` and are simply unverified — there was no backfill.
- **Register never fails on a mail problem.** `requestVerification` is called best-effort and a throw is logged at `warn`; the account exists and the caller is already signed in, so a queue outage must not turn a successful registration into an error. The user can ask again from the banner.
- **Verification links last 24 hours**, against the reset link's 30 minutes: nothing about it is urgent, and the mail may sit unread. `deadline_at` on the job is a day for the same reason.
- **Resend is a no-op when already verified**, and returns the same 202 either way so the response says nothing beyond "the request was taken". It sits behind the same `EMAIL_SEND_RATE_LIMIT_*` limiter as `forgot`.
- **A password reset also verifies the address.** Reading a link sent to that inbox is exactly the proof verification asks for, so `resetPassword` sets `email_verified_at` when it is unset — an already-verified user keeps their original timestamp.
- **`email_verified_at` is set only through `UserRepository.setEmailVerifiedAt`**, deliberately kept off `UpdateUserPatch` so proof of ownership cannot be written through a generic patch. It flows out to the SPA via `SessionIssuer.toPublicUser` with no serializer change.

## 5. Google sign-in

A server-side authorization-code flow with PKCE. The SPA never talks to Google and never sees a Google token; it ends up with the same `rt` cookie a password login sets.

```
GET /auth/google/start?return_to=/notes                                    → 302 Google
  └► GoogleAuthSvc.startAuthorization ─► state + PKCE verifier into HttpOnly g_oauth cookie (10 min)

GET /auth/google/callback?code&state                                       → 302 SPA
  └► state == cookie? ─► exchange code (with verifier) ─► verify ID token
     ─► resolve user ─► SessionIssuer.issue ─► set rt cookie ─► APP_PUBLIC_URL + return_to
         │ on load, the SPA's bootstrapSession() turns the cookie into a session
```

Resolving the user, in order:
1. A user whose `google_sub` matches → sign in.
2. A user with the same email, **only if Google says `email_verified`** → link (`linkGoogleAccount`), set `email_verified_at` if unset, sign in. A user already linked to a *different* Google account is refused.
3. Otherwise, if verified → create a user with no `password_hash`, `email_verified_at` set, and no verification email.

- **Both routes are browser navigations, so they never return a problem document.** Every failure redirects to `/login#error=google_failed` (or `google_cancelled`, `google_unavailable`), and the login page shows a message.
- **`return_to` is only ever a same-origin path** (`GoogleAuthSvc.sanitizeReturnTo`); anything else becomes `/notes`, so the callback cannot be used as an open redirect.
- **Google-only users have no password.** Password login fails with the usual `Invalid credentials` (logged as `no_password_set`); forgot-password works and gives them one.
- **Config:** `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` enable it (unset → disabled), and `GOOGLE_OAUTH_REDIRECT_URI` must match an authorized redirect URI on the Google "Web application" client. Local: `http://localhost:3000/api/v1/auth/google/callback`; prod: `https://api.cortexapp.me/api/v1/auth/google/callback`.
- **The adapter** ([google_oauth_adapter.ts](../src/auth_svc/adapters/google_oauth_adapter.ts)) wraps `google-auth-library` and Zod-validates the ID token claims. Logs carry `user_id` and `outcome` (`existing` / `linked` / `created`), never the Google claims.

## 6. Gotchas

- **`JWT_ACCESS_SECRET` is required**; `TokenUtils` throws `missing_env:JWT_ACCESS_SECRET` on first use. Rotating it invalidates every access token in flight.
- **Expired sessions are pruned nightly, but revoked ones still accumulate.** The collection has a plain index on `expires_at`, not a TTL index; a `refresh_token_prune` handler is registered with [jobs_svc](jobs_svc.md) and deletes anything past `expires_at`, but it only runs if a schedule exists for it - create one under `/api/v1/admin/jobs/schedules` (a nightly cron is the intended shape). Nothing is seeded automatically. A session revoked before its expiry — by logout, or all of a user's sessions on a password reset — sticks around until that expiry passes.
- **Issuer/audience claims are commented out** in `token_utils.ts`; enable signing and verification together if you turn them on.
- **Cross-site SPA setups need `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true`** plus the SPA origin in `CORS_ORIGINS`, since the client sends credentials.
- **Auth failures log a `reason`** (`email_taken`, `bad_password`, `session_revoked`, `rotation_failed`, `token_invalid`, `send_in_flight`, …) and never the email or password.
