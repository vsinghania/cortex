# mcp

Model Context Protocol, both directions: [src/mcp/server/](../src/mcp/server/) is a framework for exposing Cortex capabilities as MCP tools, plus the notes server built on it; [src/mcp/client/](../src/mcp/client/) consumes MCP servers.

MCP is how Cortex avoids writing the note surface twice — the chat agent, the realtime voice model and any external client reach the same seven tools.

---

## 1. Server framework

Two abstract classes separate "how to serve" from "what to serve":

- **`BaseMcpHttpServer`** — a subclass supplies `getServerInfo()`, `getHttpConfig()` and `createMcpModules()`; it inherits body parsing, host validation, trace context, request logging, bearer auth, the streamable-HTTP transport and signal-driven shutdown.
- **`McpModule`** — a unit of capability. Override `registerTools`/`registerResources`/`registerPrompts`, and always register through the base's `registerTool(...)` wrapper so every invocation emits a uniform `MCP tool invoked` / `MCP tool failed` line.

**Every POST builds a fresh `McpServer` and transport and closes both afterwards** (no session id — stateless, no resumption). Modules are long-lived and hold the service instances; only the protocol objects are per-request.

## 2. Trust model

This is the part worth reading twice.

- **Authorization is a single shared bearer token** — the `Authorization` header must equal `Bearer ${auth_token}` exactly, or the request gets a JSON-RPC `-32001`.
- **Identity is a header, not a token.** `X-User-Id` becomes the trace context's `user_id`; tools call `requireUserId()` and throw without it. `X-Trace-Id` becomes `upstream_trace_id`, linking logs across processes.
- So **the bearer token is a service credential and `X-User-Id` is the tenant selector**: anyone holding the token may act as any user. Treat `MCP_NOTES_AUTH_TOKEN` as a production secret.
- **Host validation** uses the SDK's allow-list when `MCP_NOTES_ALLOWED_HOSTS` is set and localhost validation when bound to loopback; binding `0.0.0.0` with neither logs a warning and runs without the DNS-rebinding guard.

## 3. The notes server

[src/mcp/server/notes/](../src/mcp/server/notes/) — its own process (`npm run mcp:notes:dev`), with its own Mongo connection and Qdrant bootstrap. It shares databases with the web server, not memory.

Tools, all backed by `NotesSvc` and all user-scoped: `notes_list`, `notes_get`, `notes_create`, `notes_update`, `notes_delete`, `notes_search` (lexical), `notes_search_semantic` (vector; returns ranked chunks with the `chunk_id` used for `[c:…]` citations).

Every handler is the same three steps — `requireUserId()`, parse args with Zod, call `NotesSvc` — and returns both `content` (pretty JSON text) and `structuredContent`. Tool *descriptions* are the only documentation the model gets: write them for an LLM, saying when to call and what the fields mean.

## 4. Client side

`McpClientInterface` wraps the SDK behind our own types, with HTTP and stdio adapters and a factory that caches one client per deterministic config key.

**This is not what agent runs use.** [agent_svc](agent_svc.md)'s `McpServerRegistry` goes through the `@openai/agents` SDK's own MCP client, because the tools must be handed to the agent SDK. `src/mcp/client` is the standalone path, used by [scripts/mcp_http_smoke.ts](../scripts/mcp_http_smoke.ts).

## 5. The reverse proxy

`/api/v1/mcp/notes` forwards to `MCP_NOTES_INTERNAL_URL` so OpenAI Realtime — which hosts the MCP client for voice — can reach a server that otherwise listens internally. It is mounted before `express.json()`; see [architecture.md §1](architecture.md#1-processes-and-topology). It **does not authenticate**: headers pass through and the notes server's bearer check is the only gate. In production this route is internet-facing, because [voice](voice.md) requires it to be, so that bearer token is the entire perimeter around every user's notes. Unset `MCP_NOTES_INTERNAL_URL` means the route is not mounted at all.

## 6. Extending

- **New tool** → a Zod schema and a `registerXTool(server)` method in the module, registered via the inherited wrapper.
- **New MCP server** → subclass `McpModule` and `BaseMcpHttpServer`, add an entry point, npm scripts and a compose/k8s service; then insert an `McpServerManifest` row to let agents use it.

Smoke tests: `npm run mcp:smoke` (client against the server) and `npm run agent:smoke:notes-mcp` (an agent run through the tools).
