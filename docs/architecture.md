# Cortex — system architecture

Cortex is a personal "second brain": notes are captured by hand, by voice, or by an agent; chunked and embedded on write; and recalled through an LLM agent that semantically searches them and cites the chunks it used.

This is the system-level map. Module docs are listed in [README.md](README.md); coding conventions live in [CLAUDE.md](../CLAUDE.md) and recurring idioms in [patterns.md](patterns.md).

---

## 1. Processes and topology

Two long-running Node processes, one browser app, two datastores.

| Process | Entry point | Port | Role |
| --- | --- | --- | --- |
| `web-server` | [src/web-server/server.ts](../src/web-server/server.ts) | 3000 | The API. Hosts every domain service in-process and reverse-proxies MCP traffic. |
| notes MCP server | [src/mcp/server/notes/server.ts](../src/mcp/server/notes/server.ts) | 3010 | Exposes the user's notes as MCP tools over streamable HTTP. |
| `web` SPA | [web/](../web/) | 5173 (dev) | React client. Talks to the API only — except during a voice call. |
| MongoDB | — | 27017 | System of record. |
| Qdrant | — | 6333 | Vector index for note chunks. |

```
        Browser SPA (web/)
              │  REST + Bearer JWT + rt cookie          ▲  WebRTC audio + tool events
              ▼                                         │
   ┌──────────────────────────────────┐                 │
   │  web-server  :3000               │──── OpenAI ─────┘
   │  /api/v1/{auth,ai,agent,notes,   │   (chat, embeddings, realtime)
   │           voice,health}          │        │
   │  /api/v1/mcp/notes  ── proxy ────┼────┐   │ hosted-MCP tool call
   └───────┬──────────────────────────┘    │   │ (VOICE_MCP_PUBLIC_URL)
           │ MCP client (agent runs)       ▼   ▼
           └──────────────────────►  notes MCP server :3010
                       │                   │
                       ▼                   ▼
                 Mongo :27017         Qdrant :6333
```

Two structural decisions to internalize:

- **The notes MCP server is a process, not a library.** The chat agent (server-to-server) and OpenAI Realtime (through the proxy) reach the same tool surface over the same protocol, so voice capture and chat recall cannot drift apart.
- **`/api/v1/mcp/notes` exists because OpenAI must reach us.** For voice, OpenAI hosts the MCP *client*, so the server needs a public URL. The proxy is mounted **before `express.json()`** so the body stays a raw stream — reordering it silently breaks MCP.

## 2. Layering

```
controller (web-server/**)      HTTP only: routing, auth, validation, response envelope
service   (*_svc/*.ts)          Business logic behind a *_svc_interface.ts contract
adapter   (*/adapters/**)       Vendor SDK boundary
repository(*/repositories/**)   Storage boundary: interface + Mongoose/Qdrant impl
db/                             Connections and collections. No domain knowledge.
```

Controllers hold no logic; services never touch a driver. Everything else about how this is written — registries, factories, singletons, wrappers, Zod-at-the-boundary — is in [patterns.md](patterns.md).

## 3. Identity and tracing

The user id travels: JWT claim → `req.auth.user_id` → `TraceContext` → `x-user-id` on outbound MCP calls → `TraceContext` in the MCP server → `user_id` filter on every Mongo query and Qdrant search. **Every repository method is user-scoped; there is no unscoped read path for note data.**

`TraceContext` also carries `trace_id` and `upstream_trace_id`, which is what stitches a chat request and the tool calls it triggers into one trace across two processes. Mechanics in [platform.md](platform.md).

## 4. Module map

| Doc | Covers |
| --- | --- |
| [agent_svc.md](agent_svc.md) | Agent manifests, registries, tools, MCP wiring, conversations |
| [ai_svc.md](ai_svc.md) | Single-shot text and structured generation |
| [recall.md](recall.md) | Notes, chunking, embeddings, semantic retrieval |
| [mcp.md](mcp.md) | MCP server framework, notes tools, client, reverse proxy |
| [auth.md](auth.md) | JWT access tokens, rotating refresh sessions, users |
| [voice.md](voice.md) | Ephemeral OpenAI Realtime sessions |
| [web.md](web.md) | HTTP surface and the SPA that consumes it |
| [platform.md](platform.md) | Logger, errors, trace context, middlewares, lib wrappers, db |

Dependencies point one way:

```
web-server ──► auth ──► user
           ├─► ai_svc ─────────────────► OpenAI
           ├─► agent_svc ──► ai_svc                (conversation titles)
           │              └► mcp client ──────────► notes MCP server
           ├─► notes ─┬► embeddings ──────────────► OpenAI
           │          └► retrieval ──► embeddings + Qdrant
           └─► voice ──────────────────────────────► OpenAI Realtime

common/ · lib/ · db/   — used by all, depend on none
```

## 5. End-to-end flows

### Write a note

```
SPA ─POST /api/v1/notes─► NotesSvc.createNote ──► Mongo
                              └► NotesVectorizationSvc ─► chunk → embed → Mongo + Qdrant
```

Vectorization runs inline with the write and degrades rather than failing it. Pipeline detail in [recall.md](recall.md).

### Ask a question (chat recall)

```
SPA ─POST /api/v1/agent/run─► AgentSvc ─► OpenAiAgent ─MCP, x-user-id─► notes MCP server
                                                                 │  notes_search_semantic
                                                                 ▼
                                              embed question → Qdrant top-k (user-filtered)
                                              → chunk text from Mongo → + note titles
                                                                 │
              answer citing [c:<chunk_id>] ◄────────────────────┘  → ConversationStore.appendTurn
```

The seeded `notes-recall` agent is instructed to make exactly one `notes_search_semantic` call before answering and to cite every load-bearing claim as `[c:<chunk_id>]`. Grounding is enforced by prompt, but the cited ids are verifiable against the tool result.

### Capture by voice

```
SPA ─POST /api/v1/voice/session─► VoiceSvc ─► OpenAI /v1/realtime/client_secrets
                                              (instructions + MCP tool pinned server-side)
     client_secret ─► browser opens WebRTC directly to OpenAI
                      OpenAI calls the MCP tool ─► /api/v1/mcp/notes ─► notes MCP server
```

Audio never touches our servers. The browser gets a short-lived secret; the instructions and the user's identity are baked in server-side. See [voice.md](voice.md).

## 6. Data stores

**Mongo, one database per service**, named by `DbNameResolver` (`MONGO_DB_{SERVICE}` → `MONGO_DB_NAMESPACE` → `MONGO_DB_APP` → `{service}_db`) — one namespace variable moves the whole system to a fresh set of databases, which is how dev/test isolation works.

| Service key | Holds |
| --- | --- |
| `user` / `auth` | users / refresh-token sessions |
| `notes` | notes, note chunks, note trash |
| `agent` | agent + MCP server manifests, conversations, messages |

**Qdrant** holds `note_chunks_vec` — cosine, sized from the embedding model, payload-indexed on `user_id`. Point ids are chunk ids: Mongo owns chunk text, Qdrant owns vectors plus `{user_id, note_id, source}`.

## 7. Startup and lifecycle

`Server.start()` runs, in order: Mongo connect (**fatal**), Qdrant collection bootstrap, `RetrievalSvc.create()`, `NotesRecallAgentSeed.ensure()`, `AgentSvc.create()` (warms tool/agent/MCP registries and compiles the agent graph), `AiSvc.getInstance()`. Everything after Mongo is warn-only.

The rule is **degrade, don't crash**: only the database is required to boot; every other failure logs a warning and surfaces on the request that needs it. `AgentRegistry` and `McpServerRegistry` then refresh themselves every 10 minutes. `SIGINT`/`SIGTERM` closes Mongo, then the HTTP server.

## 8. Known rough edges

- **MCP server manifests are not seeded.** `NotesRecallAgentSeed` references `mcp_server_id: 'notes'`, but nothing inserts that `McpServerManifest` row and there is no admin route for it — on a fresh database the recall agent silently has no tools.
- **Semantic search has no REST route.** `notes_search_semantic` is MCP-only; the HTTP notes API is CRUD plus lexical search.
- **Vectorization is synchronous with the write.** A slow embedding call slows the note response, and there is no queue or retry beyond an explicit `revectorizeNote`.
- **The MCP proxy does not authenticate.** It forwards whatever `Authorization` header it gets; the notes MCP server's bearer check is the only gate.
- **`NotesSvc` and `AuthSvc` are constructed per request** while every other service is a singleton — cheap, but two conventions for one thing.
