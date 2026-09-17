# Patterns

The idioms used throughout the code, so new code looks like the code already here. Consistency is this codebase's main asset — section 6 lists where it has already broken.

---

## 1. Structural

**Layered, uniformly.** `controller → service → adapter | repository → driver`. A file's path is predictable from its job.

**Interface-first.** Fifteen `*_interface.ts` files, in two flavours: service contracts (the module's public surface) and repository contracts (the storage seam). Implementations are named for their technology — `MongooseNoteRepository`, `QdrantChunkVectorRepository` — so swapping storage is a constructor change.

**Adapter at every vendor boundary.** `GenAiAdapter`, `EmbeddingAdapter`, `RealtimeVoiceAdapter`, `CorpusRetriever`, `McpClientInterface`. No `openai` import exists outside an `adapters/` directory.

**Anti-corruption wrappers for utility packages.** `Id`, `Time`, `Tokenizer`, `LruCache` in [src/lib/](../src/lib/) — nanoid, uuid, js-tiktoken and lru-cache each appear in exactly one file. Framework SDKs (express, mongoose, pino, zod, openai) are exempt.

**Template method for extensible bases.** A public orchestrator plus protected hooks: `BaseAgent` (`compile`/`run` → `onCompile`/`onRun`), `BaseMcpHttpServer` (`start` → `getServerInfo`/`getHttpConfig`/`createMcpModules`), `McpModule` (`register` → `registerTools/Resources/Prompts`), `BaseModelFactory` (`getModel` → `buildSchema`/`getModelName`).

## 2. Creational

**Factory methods over constructors.** Seventeen files expose `static create()` with a private constructor, so a partially initialized instance cannot exist.

**Async lazy singleton with in-flight dedup** — the most-copied shape in the repo (7 modules). Concurrent first callers share one bootstrap; the `loadInstance()` helper exists to satisfy the no-IIFE convention while still assigning the promise synchronously.

```ts
static async getInstance(): Promise<X> {
  if (X.instance) return X.instance;
  if (X.in_flight) return X.in_flight;
  X.in_flight = X.loadInstance();
  return X.in_flight;
}
private static async loadInstance(): Promise<X> {
  try { /* build, assign X.instance */ } finally { X.in_flight = null; }
}
```

**Registry keyed on an enum.** `AdapterRegistry`, `VoiceAdapterRegistry`, `AgentFactory`, `ToolRegistry`, `McpServerRegistry`, `StructuredSchemaRegistry`, `RetrievalSvc`'s corpus map. Adding a provider is: enum value + implementation + one map entry.

**Cache-keyed construction.** Models per connection (`WeakMap`), Mongo roots per `host:port`, MCP clients per deterministic config hash.

## 3. Behavioral

**Ambient context instead of parameter threading.** `TraceContext` (`AsyncLocalStorage`) + the pino mixin: `trace_id`/`user_id` never appear in a signature yet appear on every log line and outbound MCP header.

**Decorators as AOP.** `@logExecTime({ threshold_in_ms })` logs only when a call exceeds its threshold — for spotting slow paths, not per-call timing. Used on the agent run (5s), `ai_svc` (10s), vectorization (5s), retrieval (3s), voice mint (2s), embeddings (5s). `@validateRequest` attaches Zod validation. Decorator factories are the sanctioned exception to the no-free-functions rule.

**Manifest-driven runtime.** Agents and MCP servers are *data* in Mongo, not code. The registry builds the graph in three passes (build → wire → compile) with lazy compile, which is what allows cyclic agent graphs.

**Protocol as an internal boundary.** MCP is not only an external integration — it is how one implementation of the notes tools serves the chat agent, the voice model, and third parties.

## 4. Data and typing

**Discriminated unions** — `ToolResult`, `StructuredSchemaSource`, `NoteLocator`, `McpContent` (17 `kind:`-style sites).

**Zod at boundaries only** — HTTP bodies, MCP tool arguments, external API responses, config. Plain TypeScript past the line.

**Two-shape DTOs with a decoration seam** — `RawRetrievedChunk` → `RetrievedChunk` (+ `document_title`), `SessionIssuer.toPublicUser` stripping `password_hash` and `google_sub`, `toDomain` stripping `_id`. The shape leaving a layer is never the shape that entered it.

**Content-hash diffing** — chunk hashes make re-indexing incremental.

**Units in names** — `REFRESH_INTERVAL_MS`, `Time.minutesToMs(10)`, `duration_ms`.

## 5. Resilience

**Best-effort side effects.** `vectorizeSafely`, `persistTurn`, title generation and five of six startup steps catch, log at `warn`, and continue. The primary write succeeds or fails on its own; everything downstream degrades.

**One error translation point.** Services throw `HttpError` subclasses; only the error middleware renders them. An unrecognized throw is wrapped so no stack trace reaches a client.

**Single-flight**, arrived at independently three times: `LruCache.getOrCompute`, the web client's `refresh_promise`, the connection manager's `in_flight` map.

## 6. Where the pattern breaks

Fix opportunistically when already in the file.

| Break | Where | Cost |
| --- | --- | --- |
| Two validation mechanisms, and the one in use discards its output | [validation_decorators.ts](../src/lib/decorators/validation_decorators.ts) vs [validate.ts](../src/common/middlewares/validate.ts) | Zod `default()`/`transform()` never reach handlers, so controllers hand-convert or re-`parse()`. `ValidationMiddleware` does it correctly and has zero callers. |
| Free functions outside the sanctioned exception | [mcp_client_factory.ts](../src/mcp/client/factory/mcp_client_factory.ts) | The only real violation of the no-free-functions rule. |
| Mixed service lifecycles | `NotesSvc`/`AuthSvc` per request, everything else singleton | Two conventions for one thing. |
| Two logging call styles | Five files use `logger.info({ msg: '...' })` | Loses pino's message field; the convention is `logger.info({ fields }, 'event message')`. |
| Duplicate schemas for one object | [notes.controller.ts](../src/web-server/notes/notes.controller.ts) and [notes_mcp_module.ts](../src/mcp/server/notes/notes_mcp_module.ts) | Defensible (two untrusted boundaries) but they drift — a field added to one is invisible from the other. |
| Inconsistent error forwarding | [ai.controller.ts](../src/web-server/ai/ai.controller.ts) relies on Express 5 promise handling; others call `next(e)` | Works, but differs from its neighbours. |

**Dead code:** `logExecutionTime` (unused second decorator), the deprecated `Validator`, the unused `LruCache`, and `typedi` + `reflect-metadata` in `package.json` with no imports anywhere.

## 7. Checklist for new code

- One layer per file — controller, service, adapter, or repository.
- Interface for the contract; implementation named for its technology.
- `static create()` / `getInstance()`, private constructor.
- Third-party utility? Wrap it in `lib/` so it is imported once.
- Zod at the boundary only; units in the name; no free functions.
- One `info` line per business operation, snake_case fields, past-tense message, no prompts or payloads.
- Can it fail without invalidating the primary write? Degrade with a `warn`.
