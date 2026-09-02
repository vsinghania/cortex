# voice

Hands-free capture and recall. The service does one thing: mint a short-lived, pre-configured OpenAI Realtime session for the authenticated user. The conversation then happens directly between the browser and OpenAI — Cortex is not in the audio path.

Source: [src/voice_svc/](../src/voice_svc/) plus [voice_session.ts](../web/src/lib/voice_session.ts) in the SPA. Contract: `VoiceSvcInterface.mintEphemeralToken({ user_id })` → `{ session_id, client_secret, expires_at, model, provider }`, exposed as `POST /api/v1/voice/session`.

---

## 1. The flow

```
SPA ─POST /voice/session─► VoiceSvc ─► OpenAI /v1/realtime/client_secrets
                                        { instructions, tools: [mcp attachment] }
     client_secret ─► browser ══ WebRTC audio ══► OpenAI Realtime
                                        │ MCP tool call
                                        ▼
                          VOICE_MCP_PUBLIC_URL → /api/v1/mcp/notes → notes MCP server
```

## 2. Design notes

- **The session is configured server-side before the client ever sees it.** Instructions and an MCP tool attachment carrying `Authorization: Bearer <MCP_NOTES_AUTH_TOKEN>` and `X-User-Id: <user_id>` are baked into the mint request, so the model already knows how to behave and can only touch this user's notes.
- **The browser holds a secret that expires in minutes**, never an API key, and cannot re-scope what it was given.
- **The MCP endpoint must be publicly reachable**, because OpenAI hosts the MCP client — that is the reason the proxy exists. Locally this means a tunnel.
- **`McpAttachmentSpec` is our vocabulary**, converted to OpenAI's shape in one adapter method, so a second realtime provider only implements `RealtimeVoiceAdapter`.
- **The OpenAI response is Zod-parsed**, so a shape change fails loudly instead of handing back an unusable secret.

## 3. The instructions

[voice_capture_instructions.ts](../src/voice_svc/prompts/voice_capture_instructions.ts) is the actual product behaviour — read it before changing anything about voice:

- **Capture mode** holds a working draft (`title`, cleaned `body`, verbatim `body_raw`), reads back a one-or-two sentence summary, accepts spoken edits, and calls `notes_create` **only on an explicit "save"**. Both body fields are passed, which is why voice notes keep their transcript.
- **Recall mode** makes one `notes_search_semantic` call, answers in 1–3 spoken sentences grounded only in the returned chunks, and never reads chunk ids aloud.

Note the contrast with the chat agent: same tools, but a spoken-output prompt that suppresses the `[c:<chunk_id>]` citations the text agent requires.

## 4. Gotchas

- **A missing `VOICE_MCP_PUBLIC_URL` or `MCP_NOTES_AUTH_TOKEN` still mints a session — without tools.** The model talks but can neither read nor save notes. This is the first thing to check when voice "works" but nothing is captured; the `voice session minted` log line reports `mcp_attached`.
- **`require_approval: 'never'`** is set on the attachment, so tool calls are not gated. The safety boundary is the pinned `X-User-Id`, not user confirmation.
- **`stop()` must run** on the client — a leaked mic track keeps the browser's recording indicator on.
- **An unsupported `VOICE_PROVIDER` throws at bootstrap**, and the client refuses a provider it does not recognize.
