# mcp

Model Context Protocol, both directions: [src/mcp/server/](../src/mcp/server/) is a framework for exposing Cortex capabilities as MCP tools, plus the notes server built on it; [src/mcp/client/](../src/mcp/client/) consumes MCP servers.

MCP is how Cortex avoids writing the note surface twice — the chat agent, the realtime voice model and any external client reach the same seven tools.

---

## 1. Server framework

Two abstract classes separate "how to serve" from "what to serve":

- **`BaseMcpHttpServer`** — a subclass supplies `getServerInfo()`, `getHttpConfig()` and `createMcpModules()`; it inherits body parsing, host validation, trace context, request logging, bearer auth, the streamable-HTTP transport and signal-driven shutdown.
- **`McpModule`** — a unit of capability. `registerCapabilities()` calls the `registerTools`/`registerResources`/`registerPrompts` overrides. Always register tools through the base's `registerTool(...)` wrapper. The SDK validates inputs and applies defaults before the handler receives schema-inferred arguments. Handlers return objects; the wrapper produces compact text and `structuredContent` and emits a uniform `MCP tool invoked` / `MCP tool failed` line.

**Built on MCP TypeScript SDK v2** (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`). `createMcpHandler` with an explicit **`legacy: 'stateless'`** policy serves 2026-07-28 clients the modern per-request exchange and 2025-era clients statelessly from the same factory, so neither generation is locked out. GET and DELETE, the 2025 session operations, answer 405. The `@openai/agents` client behind chat negotiates the modern protocol; OpenAI Realtime behind voice and older connectors may not. The v2 *client* only tries the modern protocol when asked (`versionNegotiation: { mode: 'auto' }`).

**Every request gets a fresh `McpServer` from the factory** (no session id, no resumption). Modules are long-lived and hold the service instances; only the protocol objects are per-request. The server authenticates the request first and hands the resulting **`McpCaller`** to the factory as the SDK's `authInfo`; modules register their tools for that caller, and tools take the user from it rather than reading a header themselves.

## 2. Trust model

This is the part worth reading twice. The notes server decides who is calling from credentials alone:

- **Exactly the service bearer** (`MCP_NOTES_AUTH_TOKEN`, compared in constant time) is an **internal** caller with every tool, acting for the `X-User-Id` it sends. Agent runs use it. Holding this token means acting as any user, so it never leaves the private network: everything from outside, voice included, goes through the public gateway (§5).
- **A gateway-signed caller assertion** ([mcp_caller_assertion.ts](../src/mcp/server/mcp_caller_assertion.ts)) is an **external** (a third-party assistant) or **first-party** (Cortex's own caller) caller with exactly its grant's scopes. It is an HS256 JWT under `MCP_GATEWAY_ASSERTION_SECRET`, addressed to one server by its audience (the notes server's is `cortex-notes-mcp`, so an assertion for another MCP server is refused here), lives 60 seconds, and carries the user, client and scopes. It can never claim to be internal.
- **Anything else is a 401.** No header's presence or absence widens access, and `X-User-Id` counts only alongside the service bearer.
- `X-Trace-Id` becomes `upstream_trace_id`, linking logs across processes.
- **Host validation** uses the SDK's allow-list when `MCP_NOTES_ALLOWED_HOSTS` is set and localhost validation when bound to loopback; binding `0.0.0.0` with neither logs a warning and runs without the DNS-rebinding guard.

## 3. The notes server

[src/mcp/server/notes/](../src/mcp/server/notes/) — its own process (`npm run mcp:notes:dev`), with its own Mongo connection and Qdrant bootstrap. It shares databases with the web server, not memory.

[NotesMcpModule.create()](../src/mcp/server/notes/notes_mcp_module.ts) initializes its services before construction. Tests inject services through `fromServices()` and exercise validation through an in-memory SDK connection. Input and output schemas live in [notes_mcp_schemas.ts](../src/mcp/server/notes/notes_mcp_schemas.ts).

Tools, all backed by `NotesSvc` / `NoteFoldersSvc` and all user-scoped: `notes_list`, `notes_tags`, `notes_get`, `notes_create`, `notes_update`, `notes_delete`, `notes_search` (lexical), `notes_search_semantic` (vector; returns ranked chunks whose `chunk_id` is what [citations](citation_svc.md) reference), `notes_folders` (flat `{id, path, note_count}` rows), `notes_folder_create` (idempotent, by slash path) and `notes_bulk_update` (move, archive, pin, tags on up to 100 notes).

Archived notes are hidden from `notes_list`, `notes_search` and `notes_search_semantic` unless asked for. `notes_bulk_update` has **no delete action on purpose** — `notes_delete`, one note at a time, stays the only destructive tool — and folder rename/move/delete and tag deletion are REST-only. Because MCP input schemas are one object shape, `notes_bulk_update` takes a flat `{ids, action, folder_id?, tags?}` and re-checks per-action requirements in the handler.

Note what the semantic tool's description deliberately does **not** say: it states that `chunk_id` is stable and safe to reference, but never prescribes the `[c:…]` marker format. That syntax belongs to citation_svc and is taught by the agent's prompt, so a second agent calling the same tool does not silently inherit a citation convention it never asked for. A tool describes its data; the agent decides what referencing means.

**Scopes are checked twice.** Each tool declares the scope it needs (`notes:read` or `notes:write`, vocabulary and assertion audience in [notes_mcp_contract.ts](../src/mcp/server/notes/notes_mcp_contract.ts)); a tool the caller's scopes do not cover is never registered, so it is never listed, and the wrapper re-checks the scope on every invocation. Internal callers pass both checks.

**Write schemas take only what a person would set** — title, body, body_raw, tags, folder, archived, pinned. Provider keys, sync state and vectorization are Cortex's own bookkeeping, and external models reach these schemas too. Every tool carries MCP annotations (`readOnlyHint`; an explicit `destructiveHint` on writes, `true` only for delete and update). They are hints a host may use to decide when to ask the user; nothing relies on that.

**External callers get a different view.** Server instructions ([notes_mcp_instructions.ts](../src/mcp/server/notes/notes_mcp_instructions.ts)) explain how the tools fit together; notes are trimmed of bookkeeping and every note and semantic chunk carries a `url` into the SPA ([notes_mcp_external_view.ts](../src/mcp/server/notes/notes_mcp_external_view.ts)), which is what they cite instead of Cortex chat's `[c:…]` markers. Internal and first-party callers keep the full note and no instructions.

**How it presents itself.** `serverInfo` carries a title (`Cortex Notes`), a description, the SPA as `websiteUrl`, and the Cortex logo as `icons` ([cortex_icons.ts](../src/mcp/brand/cortex_icons.ts)): a 64 px PNG and the SVG, both as `data:` URIs. The spec has clients accept icons only from the server's own origin or as data URIs, and the notes server doesn't know the public URL it's reached at. For assistants that show a site icon instead, web-server serves the same logo as `/favicon.ico` on every host it answers for, `mcp.cortexapp.me` included.

Every handler is the same three steps — the caller's user id, parse args with Zod, call `NotesSvc` — and returns both `content` (compact JSON text — it reaches the model verbatim, so indentation costs tokens) and `structuredContent`. Tool *descriptions* are the only documentation the model gets: write them for an LLM, saying when to call and what the fields mean.

**`structuredContent` does not survive the agent path.** `@openai/agents-core`'s `callTool` keeps only `parsed.content` and discards `structuredContent` and `isError`, so for agent runs the text copy is the payload and the duplication in `toStructuredTextResult` is what makes it lossless. Two consequences: the model sees the payload double-encoded as `{"type":"text","text":"{…}"}`, and a tool that throws arrives as ordinary tool output with no error signal. `OpenAiSdkUtils.toToolContent` normalizes the result back into a single `{ type: 'json', data }` content part before it is persisted, so consumers read the payload directly instead of re-parsing a string — keep the text copy in any new tool, or that normalization has nothing to parse.

## 4. Client side

`McpClientInterface` wraps the SDK behind our own types, with HTTP and stdio adapters and a factory that caches one client per deterministic config key.

**This is not what agent runs use.** [agent_svc](agent_svc.md)'s `McpServerRegistry` goes through the `@openai/agents` SDK's own MCP client, because the tools must be handed to the agent SDK. `src/mcp/client` is the standalone path, used by [scripts/mcp_http_smoke.ts](../scripts/mcp_http_smoke.ts).

## 5. The public gateway

Each public MCP server is a **resource server** on the MCP host, at `MCP_PUBLIC_BASE_URL` + its path: notes is `https://mcp.cortexapp.me/notes`, and articles or chats would sit beside it. These are the only way into the MCP servers from outside: ChatGPT, Claude and other MCP clients, and OpenAI Realtime for voice (with a first-party token per session, [voice.md](voice.md)). The old unauthenticated `/api/v1/mcp/notes` proxy is gone. [`McpResourceCatalog`](../src/mcp/resource/mcp_resource_catalog.ts) defines them, one entry each (path, display name, scopes and assertion audience from the server's contract class, internal URL variable); a resource is served only when its internal URL is set. [public_mcp_gateway.ts](../src/web-server/mcp/public_mcp_gateway.ts) mounts one gateway per enabled resource:
- It serves that resource's RFC 9728 metadata at `/.well-known/oauth-protected-resource/<path>`, naming `OAUTH_ISSUER_URL` (on the API host) as the authorization server.
- A request without a valid token gets a 401 whose `WWW-Authenticate` names that metadata and the resource's scopes.
- It verifies tokens only through [`McpTokenVerifier`](../src/mcp/resource/mcp_token_verifier.ts) — token in, `{ user, client, grant, scopes, resource, kind }` or `null` out — so it never touches token storage, and it refuses a token issued for any other resource (RFC 8707), including another of our own.
- It rate-limits per grant (120 requests a minute), strips every identity header and the caller's `Authorization`, and forwards a freshly signed caller assertion addressed to that resource's server (§2).

The gateways sit behind a **host gate** ([host_gate.ts](../src/web-server/mcp/host_gate.ts)): they answer only on the MCP host, so `api.cortexapp.me/notes` is not a second URL for the same resource. Locally both hosts are `localhost` and everything shares one port. They are mounted **before `express.json()`** so the body stays a raw stream, and before the app-wide CORS policy because metadata is read from any origin. Their settings are their own ([mcp_public_config.ts](../src/mcp/resource/config/mcp_public_config.ts)): if `MCP_PUBLIC_BASE_URL` or `MCP_GATEWAY_ASSERTION_SECRET` is unset, nothing is mounted, and `MCP_PUBLIC_BASE_URL` without `OAUTH_ISSUER_URL` fails at startup.

**Tokens.** `oauth_svc` stores grants (the lasting consent between a user, a client and one resource) and the tokens issued under them, in families, as SHA-256 hashes; [OAuthAccessTokenVerifier](../src/oauth_svc/oauth_access_token_verifier.ts) is the verifier: a token is valid while it is live and its grant exists, with the scopes both allow. Clients get tokens from the OAuth authorization server ([oauth.md](oauth.md)); to exercise a resource by hand, mint one with `npx tsx scripts/mint_mcp_dev_token.ts <user_id> [read|read_write] [ttl_minutes] [resource_id]`.

**Adding a public MCP server** (articles, chats): give the server a contract class with its scopes and assertion audience (like `NotesMcpContract`), add its id to `McpResourceId` and an entry to `McpResourceCatalog.DEFINITIONS`, and set its internal URL variable. The authorization server and the gateway need no changes.

## 6. Extending

- **New tool** → a zod object schema and a `registerXTool(server, caller)` method in the module, registered via the inherited wrapper with its `required_scope` and annotations.
- **New MCP server** → subclass `McpModule` and `BaseMcpHttpServer`, add an entry point, npm scripts and a compose service; then insert an `McpServerManifest` row to let agents use it.

Smoke tests: `npm run mcp:smoke` (client against the server) and `npm run agent:smoke:notes-mcp` (an agent run through the tools).
