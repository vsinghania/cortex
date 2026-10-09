# mailer_svc — outbound email

Delivers a finished email through a pluggable transport. It knows nothing about users, auth, or jobs — domain modules decide *what* to send and *when*; this module only decides *how*.

Source: [src/mailer_svc/](../src/mailer_svc/). Contract: `MailerSvcInterface` — `sendMail(message)` and `verifyTransportConnection()`.

```
domain job handler ──render──► RenderedMail ──► MailerSvc.sendMail ──► MailTransport ──► SMTP relay
(auth_svc, reminders…)   (owns its template)       (from, logs)     (SmtpMailTransport)
```

---

## 1. Who owns what

| | owns |
| --- | --- |
| **Domain module** | the template, the recipient, the job that sends it, retry policy |
| **MailerSvc** | the `from` address, transport selection, one `mail sent` / `mail send failed` log line |
| **MailTransport** | talking to the vendor; turning every failure into a `MailDeliveryError` |

The split is enforced, not just documented: `scripts/layering.test.ts` forbids `mailer_svc` from importing any domain module or `jobs_svc`. A future reminders sender adds its own template and job handler in its own module and calls `MailerSvc.sendMail` — nothing here changes.

## 2. Send from a job, never from a request

`sendMail` is a network call to a third party that can hang for seconds or fail transiently. Callers enqueue a job (see [jobs_svc.md](jobs_svc.md)) and send from its handler, so a slow relay never slows a request and a 4xx from the relay becomes a retry with backoff instead of a lost email.

**Never put a secret in the job payload.** Admins can list jobs with full payloads, and rows persist in Mongo. A handler that sends a link containing a token should carry only an id in the payload and mint the token at send time.

## 3. Failures: one error type, one decision

Transports throw `MailDeliveryError` and nothing else. Its `retryable` flag is the only thing a caller needs; a job handler maps it straight to `{ outcome: 'failed', retryable }`. `SmtpErrorClassifier` decides it:

| SMTP failure | retryable |
| --- | --- |
| 5xx reply (refusal, bad recipient, auth rejected) | no |
| 4xx reply (greylisting, rate limit, mailbox busy) | yes |
| no reply: connection, DNS, TLS, timeout | yes |
| no reply: `EENVELOPE`, `EMESSAGE`, `EAUTH`, `ENOAUTH`, `ECONFIG` | no |

The reply code wins when present — `EAUTH` with `535` is permanent, with `454` it is not.

## 4. What never gets logged

SMTP replies routinely quote the recipient (`550 <alice@…> no such user`). So `MailDeliveryError.message` is built **from codes only** and carries no `cause` — that message reaches both the logs and a job row's `last_error`. MailerSvc logs `template` (a stable name like `password_reset`), `transport`, `message_id`, `retryable`, and `duration_ms`. Never the recipient, subject, or body.

## 5. Templates

Domain templates render a `RenderedMail { subject, text, html }` and wrap their HTML in `EmailLayout.wrap()` so every email shares one shell. Build the body only from `EmailLayout.paragraph()` and `EmailLayout.button()` — both escape their input, and `button` refuses any link that isn't an absolute `http(s)` URL. Always supply a plain-text part; some clients and most spam filters read it.

## 6. Configuration

`MailerConfigLoader` Zod-parses the env on first use. **The mailer is lazy**: nothing at boot needs it, so a missing or bad config fails the first send (which a job retries) instead of the process.

| Var | Default | Notes |
| --- | --- | --- |
| `MAIL_TRANSPORT` | `smtp` | the only transport today |
| `MAIL_FROM` | — required | e.g. `Cortex <no-reply@cortexapp.me>` |
| `SMTP_HOST` | — required | `localhost` / `mailpit` in dev |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `true` only on 465 | 587 starts plain and upgrades via STARTTLS |
| `SMTP_USER` / `SMTP_PASS` | unset | both or neither |

Empty strings count as unset, because Compose interpolates an unset `${VAR:-}` to `''`. Socket timeout is 30s rather than nodemailer's 10-minute default, so a hung relay fails the attempt well inside a job lease.

## 7. Local development

`docker compose up` starts **Mailpit**, a catch-all SMTP server: every message the app sends shows up at http://localhost:8025 and nothing leaves the machine. Outside compose, `npm run mailpit:up` starts just that container.

`npm run mailer:smoke [-- to@example.com]` verifies the transport and sends one test message through whatever the env configures.

## 8. Gotchas

- **Prod sends through Resend over SMTP.** `SMTP_PASS` (the API key) is required by `deploy/docker-compose.prod.yml`, so it must be in the box's `.env` before a deploy. `MAIL_FROM` must stay on the Resend-verified domain; any other is refused with a 5xx and fails permanently. DNS prerequisites are in [deploy/aws.md §10](../deploy/aws.md).
- **Bounces never reach our logs.** The relay accepts the message at SMTP time and bounces later, so `mail sent` means *accepted by Resend*, not *delivered*. Delivery status lives in the Resend dashboard.
- **One connection per send.** The SMTP transport is not pooled. Fine at current volume; a bulk sender (reminders fan-out) should switch to nodemailer's pool and close it on shutdown.
- **`info.rejected` is checked.** A relay that accepts the message but drops the only recipient surfaces as a permanent `recipient_rejected`, not a success.
