# platform — common, lib, db

Infrastructure every module depends on and nothing depends back on: [src/common/](../src/common/) (logger, errors, trace context, middlewares), [src/lib/](../src/lib/) (wrappers and helpers), [src/db/](../src/db/) (connections and collections).

---

## 1. Logging

One configured pino instance in [logger.ts](../src/common/logger.ts). **Never `console.*`** in application code.

Its `mixin()` adds to every line automatically: `trace_id`, `user_id`, `upstream_trace_id` from the trace context, plus `caller` (`file:line (fn)`) resolved from the stack. That last one is why production runs with `--enable-source-maps` — without it the frame points into compiled JS.

Call style and level conventions are in [CLAUDE.md](../CLAUDE.md); the rule that matters most is **never log prompts, model responses or tool payloads** — counts, ids, models, usage and durations only. `password` and `authorization` are redacted.

## 2. Errors

[errors.ts](../src/common/errors.ts) defines `HttpError` and its subclasses (`BadRequest`, `Validation`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `InternalServer`, `ServiceUnavailable`), each carrying `status_code`, `error_code`, optional `details`, `cause` and response `headers`.

They serialize to **RFC 7807 problem details**, and `HttpError.toResponse` wraps anything unrecognized in an `InternalServerError` — so an unexpected throw can never leak a stack trace to a client. Services throw; only the error middleware renders.

## 3. Trace context

`TraceContext` is an `AsyncLocalStorage` holding `{ trace_id, user_id?, upstream_trace_id? }`. It uses `enterWith`, not `run`, so context sticks for the rest of the async chain without wrapping callbacks.

- HTTP middleware calls `enter()` per request, reusing an inbound `X-Request-Id`.
- `requireAuth` calls `setUserId()` once the JWT is verified — this is the single point where identity enters the context, and it is what puts `user_id` on every later log line and outbound MCP header.
- Timers call `enterBackground(task)` for a `bg:<task>:<rand>` id.
- The MCP server builds its own context from headers instead; see [mcp.md](mcp.md).

## 4. Middlewares

`requireAuth` / `optionalAuth` (bearer → `req.auth` → trace context), `authorizeRoles(...)`, `TraceContextMiddleware`, `HttpLoggerMiddleware` (pino-http; slim envelope, headers only at `debug` or on 4xx/5xx), `ValidationMiddleware`, `RateLimitMiddleware` (plus the preconfigured `authRateLimiter`), and `ErrorHandlerMiddleware`.

Controllers currently validate with the `@validateRequest` decorator instead — see the caveat in [web.md §3](web.md#3-controller-conventions).

## 5. lib

Wrappers so a third-party package is imported exactly once: `Id` (nanoid + uuid), `Time` (duration math with units in the name), `Tokenizer` (tiktoken), `LruCache` (TTL, sliding expiry, single-flight `getOrCompute`). Plus `MarkdownChunker` (see [recall.md](recall.md)), the `@logExecTime` and `@validateRequest` decorators (see [patterns.md](patterns.md)), and `JsonSchemaValidator` (Ajv, used to check an agent's `output_schema` before storing it).

When adding a utility package: wrap it in a static class here, name methods so units are explicit at the call site, and import the wrapper from feature code — never the package.

## 6. db

**Mongo** — `MongooseConnectionManager` owns every connection: one pooled *root* per `host:port` (concurrent opens de-duped), one *base* set at bootstrap that supplies the default host/port, and logical *database* connections via `useDb(name, { useCache: true })` sharing that pool. Models are built and cached per connection by `BaseModelFactory`, which is what makes registering the same model across many `useDb` connections safe. Repositories query `.lean()` and pass results through `MongooseUtils.toDomain<T>()`, so domain objects are plain types, never documents.

Database names come from `DbNameResolver` — see [architecture.md §6](architecture.md#6-data-stores).

**Qdrant** — a lazy singleton client plus `ensureCollection`, which is idempotent and called by both processes at startup. The payload-index failure path is non-fatal (warns, leaves filtered search slower). Its dimension caveat is in [recall.md §5](recall.md#5-gotchas).

`GET /api/v1/health/db` reports every root connection; status is `up` only when all are connected.

**No migrations.** Schemas and indexes are declared in the model factories and applied by Mongoose on first use.

## 7. Dependency security

Both npm projects require Node.js 22.12 or later within 22.x. Lockfiles are committed and CI installs them with `npm ci`.

The root `overrides` entry keeps `@hono/node-server` on a patched v2 release because the MCP Node adapter still declares a v1 dependency affected by [GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f). Both MCP SDKs use its `getRequestListener` API; the [v2 release](https://github.com/honojs/node-server/releases/tag/v2.0.0) preserves that API and requires Node.js 20 or later. Remove the override when the upstream dependency ranges allow a patched version without it. Validate the MCP HTTP transport when changing this dependency.
