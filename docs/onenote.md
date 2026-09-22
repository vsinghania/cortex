# OneNote integration

Read-only sync from Microsoft OneNote into Cortex notes. A user connects their Microsoft
account once from Settings; Cortex then keeps a mirror of their OneNote pages.

Phase 1 (this document's current scope) covers **connecting and disconnecting** an
account. Syncing, attachments and scheduling follow in later phases.

## Configuration

| Variable | Notes |
| --- | --- |
| `MS_OAUTH_CLIENT_ID` | Azure app registration (client) id |
| `MS_OAUTH_CLIENT_SECRET` | Client secret for the same registration |
| `MS_OAUTH_REDIRECT_URI` | Carried as a literal in compose; must match the registration exactly |
| `MS_OAUTH_AUTHORITY` | Optional; defaults to `https://login.microsoftonline.com/common` |
| `SECRET_ENCRYPTION_KEYS` | `<key_id>:<base64 32 bytes>`, comma-separated |
| `SECRET_ENCRYPTION_ACTIVE_KEY_ID` | Which of those keys new values are sealed with |

The feature is **off** unless both the client credentials and the encryption keys are set
(`OneNoteConnectionSvc.isConfigured`). Without keys there is nowhere safe to keep the
grant, so the two are deliberately coupled rather than independently optional. An unset
value is an empty string under Compose, which the config loader treats as absent.

Azure registration needs: a Web platform redirect URI matching the variable above, and
the delegated permissions `offline_access`, `Notes.Read`, `User.Read`. `common` as the
authority lets both personal and work/school accounts connect.

## Flow

1. The SPA calls `POST /api/v1/integrations/onenote/start` with its bearer token and gets
   back `{ url }`, then sets `window.location`.
2. That response also sets `ms_oauth`, an HttpOnly cookie holding the OAuth `state`, the
   PKCE verifier and the connecting `user_id`, scoped to the callback path, 10 minutes.
3. Microsoft redirects to `GET /api/v1/integrations/onenote/callback`.
4. The callback checks `state`, then checks that the browser's own session (its refresh
   cookie) belongs to the user named in the state cookie. Only then does it exchange the
   code, seal MSAL's token cache and store the connection, and redirect to
   `/settings#connected=onenote` (or `#error=...`).

**Why start is a POST rather than a redirect.** Google sign-in's `/start` can be a plain
link because it *is* the login — there is no user yet. Here the server has to know which
Cortex user is connecting, and a browser navigation carries no `Authorization` header. So
the SPA fetches the URL with its token and navigates itself; the navigation to Microsoft
is still top-level, which is what the consent screen needs.

**Why the state cookie is sealed, when Google's isn't.** A cookie needs sealing or signing
when it carries a claim the server trusts without checking it anywhere else. Every field
in Google's cookie is checked elsewhere — `state` against the URL, the verifier by Google,
`return_to` by re-sanitising — and who is signing in comes from Google's signed ID token.
This cookie also carries `user_id`, which nothing else confirms, because the callback has
no bearer token. Anyone can edit their own cookies, so unsealed, a user could write
someone else's `user_id` into it and sync their own OneNote into that account from then
on. `/start` only ever seals the signed-in caller's own id, so a sealed value can't name
anybody else.

**Why the callback also checks the session.** Sealing stops a cookie being *edited*, not
a genuine one being *planted*. Someone can start a flow as themselves, take the sealed
cookie and the authorize URL, and get them into another person's browser (cookie tossing
from a sibling subdomain, or XSS). If that person then consents, their OneNote would flow
into the planter's account, and neither the `state` check nor the seal would notice,
because the planter controls both halves and nothing was forged. So the callback reads
the browser's refresh cookie — `SameSite=lax`, so it rides along on the navigation back
from Microsoft — resolves it with `AuthSvc.sessionUserId` (a lookup that doesn't rotate
the token), and rejects unless it matches the sealed `user_id`. A browser signed in as
nobody is rejected too.

## Tokens

`@azure/msal-node` owns the token cache; Cortex owns where it lives. `acquireTokenByCode`
populates an in-memory cache, which is serialised, sealed with `SecretBox` (AAD
`{ user_id, field: 'onenote_token_cache' }`) and written to `onenote_connections`. Every
later call deserialises it into a fresh client and calls `acquireTokenSilent`, writing the
cache back only when `hasChanged()` says MSAL rotated something.

A fresh client per call is deliberate: MSAL's cache lives on the instance, so a shared
client would mix users' tokens together.

`InteractionRequiredAuthError` — a revoked or expired grant — becomes
`OneNoteReauthRequiredError`, which parks the connection as `needs_reauth` so the UI can
ask for a reconnect instead of retrying forever.

## Gotchas

- **The redirect URI must match the Azure registration character for character**, including
  scheme and trailing path. A mismatch fails at Microsoft with an error the callback can
  only report generically.
- **`COOKIE_SAMESITE` must stay `lax` (or `none`).** The session check depends on the
  refresh cookie arriving with the cross-site navigation back from Microsoft. Under
  `strict` it never arrives, and every connect fails with the generic `onenote_failed`.
- **Never log a token, a token cache, or a token response body.** The adapter logs a
  truncated body excerpt on non-OK responses only, and the service logs ids and counts.
- **`SECRET_ENCRYPTION_KEYS` must be in the secret store before this deploys.** Losing a
  key means every connected user has to reconnect. Retire a key by keeping it listed while
  making a new one active, then re-sealing in the background — never by dropping it.
- **One connection per user**, enforced by a unique index on `user_id`. This is what keeps
  the notes index `uniq_user_source_external` correct: two Microsoft accounts under one
  Cortex user would collide on OneNote page ids.
- **Disconnecting leaves imported notes in place.** They are the user's, and deleting them
  would surprise. Nothing is ever written back to OneNote.
