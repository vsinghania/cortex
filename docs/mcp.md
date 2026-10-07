# mcp

Model Context Protocol, both directions: [src/mcp/server/](../src/mcp/server/) is a framework for exposing Cortex capabilities as MCP tools, plus the notes server built on it; [src/mcp/client/](../src/mcp/client/) consumes MCP servers.

MCP is how Cortex avoids writing the note surface twice — the chat agent, the realtime voice model and any external client reach the same seven tools.

---

## 1. Server framework

Two abstract classes separate "how to serve" from "what to serve":

- **`BaseMcpHttpServer`** — a subclass supplies `getServerInfo()`, `getHttpConfig()` and `createMcpModules()`; it inherits body parsing, host validation, trace context, request logging, bearer auth, the streamable-HTTP transport and signal-driven shutdown.
- **`McpModule`** — a unit of capability. Override `registerTools`/`registerResources`/`registerPrompts`, and always register through the base's `registerTool(...)` wrapper so every invocation emits a uniform `MCP tool invoked` / `MCP tool failed` line.

**Built on MCP TypeScript SDK v2** (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`). `createMcpHandler` with an explicit **`legacy: 'stateless'`** policy serves 2026-07-28 clients the modern per-request exchange and 2025-era clients statelessly from the same factory, so neither generation is locked out. GET and DELETE, the 2025 session operations, answer 405. The `@openai/agents` client behind chat negotiates the modern protocol; OpenAI Realtime behind voice and older connectors may not. The v2 *client* only tries the modern protocol when asked (`versionNegotiation: { mode: 'auto' }`).

**Every request gets a fresh `McpServer` from the factory** (no session id, no resumption). Modules are long-lived and hold the service instances; only the protocol objects are per-request. The server authenticates the request first and hands the resulting **`McpCaller`** to the factory as the SDK's `authInfo`; modules register their tools for that caller, and tools take the user from it rather than reading a header themselves.

## 2. Trust model

This is the part worth reading twice. The notes server decides who is calling from credentials alone:

- **Exactly the service bearer** (`MCP_NOTES_AUTH_TOKEN`, compared in constant time) is an **internal** caller with every tool, acting for the `X-User-Id` it sends. Agent runs and voice use it today. Holding this token means acting as any user: treat it as a production secret.
- **A gateway-signed caller assertion** ([mcp_caller_assertion.ts](../src/mcp/server/mcp_caller_assertion.ts)) is an **external** (a third-party assistant) or **first-party** (Cortex's own caller) caller with exactly its grant's scopes. It is an HS256 JWT under `MCP_GATEWAY_ASSERTION_SECRET`, audience `cortex-notes-mcp`, a 60-second lifetime, and carries the user, client and scopes. It can never claim to be internal.
- **Anything else is a 401.** No header's presence or absence widens access, and `X-User-Id` counts only alongside the service bearer.
- `X-Trace-Id` becomes `upstream_trace_id`, linking logs across processes.
- **Host validation** uses the SDK's allow-list when `MCP_NOTES_ALLOWED_HOSTS` is set and localhost validation when bound to loopback; binding `0.0.0.0` with neither logs a warning and runs without the DNS-rebinding guard.

## 3. The notes server

[src/mcp/server/notes/](../src/mcp/server/notes/) — its own process (`npm run mcp:notes:dev`), with its own Mongo connection and Qdrant bootstrap. It shares databases with the web server, not memory.

Tools, all backed by `NotesSvc` / `NoteFoldersSvc` and all user-scoped: `notes_list`, `notes_tags`, `notes_get`, `notes_create`, `notes_update`, `notes_delete`, `notes_search` (lexical), `notes_search_semantic` (vector; returns ranked chunks whose `chunk_id` is what [citations](citation_svc.md) reference), `notes_folders` (flat `{id, path, note_count}` rows), `notes_folder_create` (idempotent, by slash path) and `notes_bulk_update` (move, archive, pin, tags on up to 100 notes).

Archived notes are hidden from `notes_list`, `notes_search` and `notes_search_semantic` unless asked for. `notes_bulk_update` has **no delete action on purpose** — `notes_delete`, one note at a time, stays the only destructive tool — and folder rename/move/delete and tag deletion are REST-only. Because MCP input schemas are one object shape, `notes_bulk_update` takes a flat `{ids, action, folder_id?, tags?}` and re-checks per-action requirements in the handler.

Note what the semantic tool's description deliberately does **not** say: it states that `chunk_id` is stable and safe to reference, but never prescribes the `[c:…]` marker format. That syntax belongs to citation_svc and is taught by the agent's prompt, so a second agent calling the same tool does not silently inherit a citation convention it never asked for. A tool describes its data; the agent decides what referencing means.

**Scopes are checked twice.** Each tool declares the scope it needs (`notes:read` or `notes:write`, vocabulary in [notes_scope.ts](../src/mcp/server/notes/notes_scope.ts)); a tool the caller's scopes do not cover is never registered, so it is never listed, and the wrapper re-checks the scope on every invocation. Internal callers pass both checks.

**Write schemas take only what a person would set** — title, body, body_raw, tags, folder, archived, pinned. Provider keys, sync state and vectorization are Cortex's own bookkeeping, and external models reach these schemas too. Every tool carries MCP annotations (`readOnlyHint`; an explicit `destructiveHint` on writes, `true` only for delete and update). They are hints a host may use to decide when to ask the user; nothing relies on that.

**External callers get a different view.** Server instructions ([notes_mcp_instructions.ts](../src/mcp/server/notes/notes_mcp_instructions.ts)) explain how the tools fit together; notes are trimmed of bookkeeping and every note and semantic chunk carries a `url` into the SPA ([notes_mcp_external_view.ts](../src/mcp/server/notes/notes_mcp_external_view.ts)), which is what they cite instead of Cortex chat's `[c:…]` markers. Internal and first-party callers keep the full note and no instructions.

Every handler is the same three steps — the caller's user id, parse args with Zod, call `NotesSvc` — and returns both `content` (compact JSON text — it reaches the model verbatim, so indentation costs tokens) and `structuredContent`. Tool *descriptions* are the only documentation the model gets: write them for an LLM, saying when to call and what the fields mean.

**`structuredContent` does not survive the agent path.** `@openai/agents-core`'s `callTool` keeps only `parsed.content` and discards `structuredContent` and `isError`, so for agent runs the text copy is the payload and the duplication in `toStructuredTextResult` is what makes it lossless. Two consequences: the model sees the payload double-encoded as `{"type":"text","text":"{…}"}`, and a tool that throws arrives as ordinary tool output with no error signal. `OpenAiSdkUtils.toToolContent` normalizes the result back into a single `{ type: 'json', data }` content part before it is persisted, so consumers read the payload directly instead of re-parsing a string — keep the text copy in any new tool, or that normalization has nothing to parse.

## 4. Client side

`McpClientInterface` wraps the SDK behind our own types, with HTTP and stdio adapters and a factory that caches one client per deterministic config key.

**This is not what agent runs use.** [agent_svc](agent_svc.md)'s `McpServerRegistry` goes through the `@openai/agents` SDK's own MCP client, because the tools must be handed to the agent SDK. `src/mcp/client` is the standalone path, used by [scripts/mcp_http_smoke.ts](../scripts/mcp_http_smoke.ts).

## 5. The reverse proxy

`/api/v1/mcp/notes` forwards to `MCP_NOTES_INTERNAL_URL` so OpenAI Realtime — which hosts the MCP client for voice — can reach a server that otherwise listens internally. It is mounted before `express.json()`; see [architecture.md §1](architecture.md#1-processes-and-topology). It **does not authenticate**: headers pass through and the notes server's bearer check is the only gate. In production this route is internet-facing, because [voice](voice.md) requires it to be, so that bearer token is the entire perimeter around every user's notes. Unset `MCP_NOTES_INTERNAL_URL` means the route is not mounted at all.

## 6. The public gateway

`/mcp` on web-server ([public_mcp_gateway.ts](../src/web-server/mcp/public_mcp_gateway.ts)) is the MCP **resource server**: the way ChatGPT, Claude and other MCP clients reach the notes server with a per-user access token.
- It serves its own RFC 9728 metadata at `/.well-known/oauth-protected-resource/mcp`, naming `OAUTH_ISSUER_URL` as the authorization server.
- A request without a valid token gets a 401 whose `WWW-Authenticate` names that metadata and the scopes to ask for.
- It verifies tokens only through [`McpTokenVerifier`](../src/mcp/resource/mcp_token_verifier.ts) — token in, `{ user, client, grant, scopes, resource, kind }` or `null` out — so it never touches token storage, and it refuses a token issued for any other resource (RFC 8707).
- It rate-limits per grant (120 requests a minute), strips every identity header and the caller's `Authorization`, and forwards a freshly signed caller assertion (§2).

It is mounted **before `express.json()`** so the body stays a raw stream, and before the app-wide CORS policy because its metadata is read from any origin. If `OAUTH_ISSUER_URL`/`MCP_PUBLIC_URL`, `MCP_NOTES_INTERNAL_URL` or `MCP_GATEWAY_ASSERTION_SECRET` is unset, it is not mounted.

**Tokens.** `oauth_svc` stores grants (the lasting consent between a user and a client) and the tokens issued under them, in families, as SHA-256 hashes; [OAuthAccessTokenVerifier](../src/oauth_svc/oauth_access_token_verifier.ts) is the verifier: a token is valid while it is live and its grant exists, with the scopes both allow. Until the OAuth authorization server lands, mint a test token with `npx tsx scripts/mint_mcp_dev_token.ts <user_id> [read|read_write]`.

## 7. Extending

- **New tool** → a zod object schema and a `registerXTool(server, caller)` method in the module, registered via the inherited wrapper with its `required_scope` and annotations.
- **New MCP server** → subclass `McpModule` and `BaseMcpHttpServer`, add an entry point, npm scripts and a compose service; then insert an `McpServerManifest` row to let agents use it.

Smoke tests: `npm run mcp:smoke` (client against the server) and `npm run agent:smoke:notes-mcp` (an agent run through the tools).
