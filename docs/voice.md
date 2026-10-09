# voice

Hands-free capture and recall. The service does one thing: mint a short-lived, pre-configured OpenAI Realtime session for the authenticated user. The conversation then happens directly between the browser and OpenAI — Cortex is not in the audio path.

Source: [src/voice_svc/](../src/voice_svc/) plus [voice_session.ts](../web/src/lib/voice_session.ts) in the SPA. Contract: `VoiceSvcInterface.mintEphemeralVoiceToken({ user_id })` → `{ session_id, client_secret, expires_at, model, provider }`, exposed as `POST /api/v1/voice/session`.

---

## 1. The flow

```
SPA ─POST /voice/session─► VoiceSvc ─► OpenAI /v1/realtime/client_secrets
                                        { instructions, tools: [mcp attachment] }
     client_secret ─► browser ══ WebRTC audio ══► OpenAI Realtime
                                        │ MCP tool call
                                        ▼
        VOICE_MCP_PUBLIC_URL | https://mcp.cortexapp.me/notes → notes MCP gateway → notes MCP server
```

## 2. Design notes

- **The session is configured server-side before the client ever sees it.** Instructions and an MCP tool attachment carrying a per-user access token are baked into the mint request, so the model already knows how to behave and can only touch this user's notes. The token comes from `OAuthSvc.issueFirstPartyAccessToken`: a one-hour, access-only `first_party` grant per session, hidden from Settings ([oauth.md](oauth.md) §2). It decides the user by itself, so no header in the attachment selects a tenant, and the gateway gives first-party calls the internal view this prompt was written for.
- **The browser holds a secret that expires in minutes**, never an API key, and cannot re-scope what it was given.
- **The MCP endpoint must be publicly reachable**, because OpenAI hosts the MCP client. It is the same notes resource (`https://mcp.cortexapp.me/notes`) external assistants use. Locally this means a tunnel, set as `VOICE_MCP_PUBLIC_URL`.
- **`McpAttachmentSpec` is our vocabulary**, converted to OpenAI's shape in one adapter method, so a second realtime provider only implements `RealtimeVoiceAdapter`.
- **The OpenAI response is Zod-parsed**, so a shape change fails loudly instead of handing back an unusable secret.

## 3. The instructions

[voice_capture_instructions.ts](../src/voice_svc/prompts/voice_capture_instructions.ts) is the actual product behaviour — read it before changing anything about voice:

- **Capture mode** holds a working draft (`title`, cleaned `body`, verbatim `body_raw`), reads back a one-or-two sentence summary, accepts spoken edits, and calls `notes_create` **only on an explicit "save"**. Both body fields are passed, which is why voice notes keep their transcript.
- **Recall mode** makes one `notes_search_semantic` call, answers in 1–3 spoken sentences grounded only in the returned chunks, and never reads chunk ids aloud.

Note the contrast with the chat agent: same tools, but a spoken-output prompt that suppresses the `[c:<chunk_id>]` citations the text agent requires.

## 4. Gotchas

- **OpenAI holds a token to this user's notes for an hour.** The attachment's bearer token leaves our network by design. A leaked one reaches one user's notes until it expires, not everyone's: the old shared-token-plus-`X-User-Id` attachment is gone, and `MCP_NOTES_AUTH_TOKEN` never leaves the private network now.
- **Voice needs the public MCP configured.** Without the public MCP settings (`OAUTH_ISSUER_URL`, `MCP_PUBLIC_BASE_URL`, `MCP_NOTES_INTERNAL_URL`), or a `VOICE_MCP_PUBLIC_URL` override,, or if minting the token fails, a session still mints — without tools. The model talks but can neither read nor save notes. This is the first thing to check when voice "works" but nothing is captured; the `voice session minted` log line reports `mcp_attached`.
- **`require_approval: 'never'`** is set on the attachment, so tool calls are not gated. The safety boundary is the per-user token, not user confirmation.
- **The model does not speak after an MCP call on its own.** `response.done` can arrive before the response's MCP calls finish, and the Realtime API never starts a follow-up response itself — without one the agent goes silent until the user speaks again. [RealtimeFollowUpTracker](../web/src/lib/realtime_follow_up_tracker.ts) watches the call lifecycle and tells `VoiceSession` to send `response.create` once no response is active and every call has settled (failures included, so the model can report them). A success is signalled by `response.output_item.done` carrying an `mcp_call` item, not by a dedicated completed event.
- **`stop()` must run** on the client — a leaked mic track keeps the browser's recording indicator on.
- **An unsupported `VOICE_PROVIDER` throws at bootstrap**, and the client refuses a provider it does not recognize.
