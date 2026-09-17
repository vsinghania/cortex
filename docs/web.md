# web — HTTP surface and SPA

The Express 5 API in [src/web-server/](../src/web-server/) and the React client in [web/](../web/) that consumes it. Two halves of one contract, so they are documented together.

---

## 1. Mounts

All under `/api/v1`. Per-endpoint request and response shapes live in the [bruno/](../bruno/) collections, which are executable.

| Mount | Auth | Backed by |
| --- | --- | --- |
| `/auth` | rate-limited; `/me` needs bearer; `/password/forgot` has a stricter email-send limit | [auth.md](auth.md) |
| `/ai` | bearer | [ai_svc.md](ai_svc.md) |
| `/agent` | bearer; create/update need `admin` | [agent_svc.md](agent_svc.md) |
| `/notes` | bearer | [recall.md](recall.md) |
| `/voice` | bearer | [voice.md](voice.md) |
| `/health/db`, `/healthz` | none | Mongo connection state (503 when down) |
| `/mcp/notes` | upstream bearer only | proxy → [mcp.md](mcp.md) |

Responses are wrapped as `{ response: <payload> }` — except `/ai/*`, which returns the service result directly, and errors, which are RFC 7807 problem details.

## 2. Middleware order

Order is load-bearing:

```
cors(credentials) → TraceContext → pino-http
  → /api/v1/mcp/notes proxy      ← BEFORE express.json(): body must stay a raw stream
  → express.json() → cookieParser() → /api/v1 routers
  → notFoundHandler → errorHandler
```

Auth and rate limiting are applied per router inside each controller's `registerRoutes()`, not globally.

## 3. Controller conventions

Each controller builds its own `express.Router`, exposes `getRouter()`, and binds private handlers. A handler validates, calls **one** service method, and wraps the result; anything more belongs in a service.

**The `@validateRequest` decorator validates but does not substitute.** The parsed value is discarded, so handlers read raw `req.body`/`req.query` and Zod `default()`/`transform()` never take effect — which is why the notes controller hand-converts query strings and the agent controller re-`parse()`s. [`ValidationMiddleware.validate`](../src/common/middlewares/validate.ts) does it correctly (`req.validated`) and has no callers; prefer it when you need coerced values.

## 4. The SPA

React 18 + React Router, Vite, no state library. `/login`, `/register`, `/forgot-password` and `/reset-password` are public (login and register also offer "Continue with Google", a plain link to the API's `/auth/google/start`); `/notes`, `/notes/:id`, `/chat`, `/voice` sit behind a `RequireAuth` route guard.

[api_client.ts](../web/src/lib/api_client.ts) is the only place `fetch` hits the API, and it owns the whole token dance: bearer from an in-memory `AuthStore`, `credentials: 'include'` for the refresh cookie, and **on a 401 it refreshes once and replays the request**, sharing one in-flight refresh across concurrent failures. Calls that work without a session — login, register, refresh, forgot and reset password — are excluded from that path. It unwraps the envelope and throws a typed `ApiError` whose message is the problem's `detail`.

Assistant turns render through react-markdown + `remark-gfm` (the model writes markdown whether or not the prompt asks for it); user turns stay literal `pre-wrap` text, so a typed `**` is not eaten. See [citation_svc.md](citation_svc.md) for how citation chips survive the markdown pass.

Voice is the one exception to "talks only to the API" — the browser opens WebRTC straight to OpenAI. See [voice.md](voice.md).

## 5. Gotchas

- **A page reload keeps the session through the cookie, not the store.** `AuthStore` is memory-only; `main.tsx` calls `ApiClient.bootstrapSession()` before rendering, which refreshes from the `rt` cookie. Google sign-in relies on this: the API's callback sets the cookie and redirects, and the reload picks it up.
- **Client types are copies, not imports.** `web/src/lib/*.types.ts` mirrors server shapes by hand; a changed payload fails at runtime, not at build. Update both in one change.
- **CORS.** `CORS_ORIGINS` must list the SPA origin, since every request is credentialed; unset means reflect any origin.
- **The SPA is not built or deployed by the Node image** — compose ships the API and MCP server only.
- **`/ai/*` handlers do not call `next(e)`**, relying on Express 5 promise handling, unlike every other controller.
