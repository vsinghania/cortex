# auth

Registration, login, session refresh, logout. Issues the JWT every other route trusts, and owns the rotating refresh sessions behind it.

Source: [src/auth_svc/](../src/auth_svc/) (flows + session store) and [src/user/](../src/user/) (the `User` entity). Contract: `AuthSvcInterface` — `register`, `login`, `refresh`, `logout`, `getMe`, each taking an optional `{ ip, user_agent }` recorded on the session.

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
- **`redactUser` strips `password_hash`** on every path out of the service.

## 2. How the rest of the system consumes it

Enforcement lives in middleware, not in this service: `requireAuth` verifies the bearer token and populates `req.auth` and the trace context; `authorizeRoles('admin')` gates agent create/update. Details in [platform.md](platform.md).

Verification is stateless, which has one important consequence: **revoking a refresh session does not invalidate an outstanding access token** — it simply stops working within 15 minutes.

## 3. Gotchas

- **`JWT_ACCESS_SECRET` is required**; `TokenUtils` throws `missing_env:JWT_ACCESS_SECRET` on first use. Rotating it invalidates every access token in flight.
- **Expired sessions are pruned nightly, but revoked ones still accumulate.** The collection has a plain index on `expires_at`, not a TTL index; a `refresh_token_prune` job runs at 03:00 UTC via [jobs_svc](jobs_svc.md) and deletes anything past `expires_at`. `revokeAllForUser` still has no caller, so there is no "log out everywhere", and a session revoked before its expiry sticks around until that expiry passes.
- **Issuer/audience claims are commented out** in `token_utils.ts`; enable signing and verification together if you turn them on.
- **Cross-site SPA setups need `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true`** plus the SPA origin in `CORS_ORIGINS`, since the client sends credentials.
- **Auth failures log a `reason`** (`email_taken`, `bad_password`, `session_revoked`, `rotation_failed`, …) and never the email or password.
