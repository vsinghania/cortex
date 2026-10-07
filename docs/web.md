# web — HTTP surface and SPA

The Express 5 API in [src/web-server/](../src/web-server/) and the React client in [web/](../web/) that consumes it. Two halves of one contract, so they are documented together.

---

## 1. Mounts

Under `/api/v1`, except the public-MCP endpoints at the root. web-server answers for two hosts: `api.cortexapp.me` (this API and the OAuth authorization server) and `mcp.cortexapp.me` (the MCP resource servers); host gates keep each surface on its host. Per-endpoint request and response shapes live in the [bruno/](../bruno/) collections, which are executable.

| Mount | Auth | Backed by |
| --- | --- | --- |
| `/auth` | rate-limited; `/me` needs bearer; `/password/forgot` has a stricter email-send limit | [auth.md](auth.md) |
| `/ai` | bearer | [ai_svc.md](ai_svc.md) |
| `/agent` | bearer; create/update need `admin` | [agent_svc.md](agent_svc.md) |
| `/notes` | bearer | [recall.md](recall.md) |
| `/voice` | bearer | [voice.md](voice.md) |
| `/admin` | bearer + `admin`, applied once by the parent router | notes reindex, [jobs_svc](jobs_svc.md), users overview (`admin_svc`) |
| `/health/db`, `/healthz` | none | Mongo connection state (503 when down) |
| `/oauth` | bearer | consent requests and connected apps, [oauth.md](oauth.md) |
| `/mcp/notes` | upstream bearer only | proxy → [mcp.md](mcp.md) (voice) |
| `/notes` (and later `/articles`, …) on **mcp.cortexapp.me** | OAuth access token | resource servers → MCP servers, [mcp.md](mcp.md) §6 |
| `/.well-known/oauth-authorization-server`, `/authorize`, `/token`, `/revoke` (root) | none (public clients, PKCE) | the OAuth authorization server, [oauth.md](oauth.md) |

Responses are wrapped as `{ response: <payload> }` — except `/ai/*`, which returns the service result directly, and errors, which are RFC 7807 problem details.

## 2. Middleware order

Order is load-bearing:

```
TraceContext → pino-http
  → OAuth AS (API host) + MCP resource servers (MCP host)   ← BEFORE cors(): any-origin CORS of their own
                                 ← BEFORE express.json(): the MCP body must stay a raw stream
  → cors(credentials)
  → /api/v1/mcp/notes proxy      ← BEFORE express.json(): body must stay a raw stream
  → express.json() → cookieParser() → /api/v1 routers
  → notFoundHandler → errorHandler
```

Auth and rate limiting are applied per router inside each controller's `registerRoutes()`, not globally.

## 3. Controller conventions

Each controller builds its own `express.Router`, exposes `getRouter()`, and binds private handlers. A handler validates, calls **one** service method, and wraps the result; anything more belongs in a service.

**The `@validateRequest` decorator validates but does not substitute.** The parsed value is discarded, so handlers read raw `req.body`/`req.query` and Zod `default()`/`transform()` never take effect — which is why the notes controller hand-converts query strings and the agent controller re-`parse()`s. [`ValidationMiddleware.validate`](../src/common/middlewares/validate.ts) does it correctly (`req.validated`) and has no callers; prefer it when you need coerced values.

## 4. The SPA

React 18 + React Router, Vite, no state library. `/login`, `/register`, `/forgot-password`, `/reset-password` and `/privacy` are public (login and register also offer "Continue with Google", a plain link to the API's `/auth/google/start`); `/notes`, `/notes/:id`, `/chat`, `/voice` and `/connect` (the consent page MCP clients send users to, [oauth.md](oauth.md)) sit behind a `RequireAuth` route guard. The guard keeps the query string through the login bounce, and login and register pass the destination along, so a user who signs up mid-way through connecting an assistant still lands on its consent page. `/admin/*` (today just `/admin/users`) is nested one level further, behind `RequireAdmin`; the rail shows its entry only to admins, and admin views are listed in `AdminNav`. The guard only hides the page: the API's role gate is the real check.

[api_client.ts](../web/src/lib/api_client.ts) is the only place `fetch` hits the API, and it owns the whole token dance: bearer from an in-memory `AuthStore`, `credentials: 'include'` for the refresh cookie, and **on a 401 it refreshes once and replays the request**, sharing one in-flight refresh across concurrent failures. Calls that work without a session — login, register, refresh, forgot and reset password — are excluded from that path. It unwraps the envelope and throws a typed `ApiError` whose message is the problem's `detail`.

Assistant turns render through react-markdown + `remark-gfm` (the model writes markdown whether or not the prompt asks for it); user turns stay literal `pre-wrap` text, so a typed `**` is not eaten. See [citation_svc.md](citation_svc.md) for how citation chips survive the markdown pass.

Voice is the one exception to "talks only to the API" — the browser opens WebRTC straight to OpenAI. See [voice.md](voice.md). Voice has its own page rather than being a mode of a thread, because nothing said in a session is saved to one; the mic button beside the rail's compose action opens it from every screen, and old `/chat?mode=voice` links redirect there.

## 5. Gotchas

- **A page reload keeps the session through the cookie, not the store.** `AuthStore` is memory-only; `main.tsx` calls `ApiClient.bootstrapSession()` before rendering, which refreshes from the `rt` cookie. Google sign-in relies on this: the API's callback sets the cookie and redirects, and the reload picks it up.
- **Client types are copies, not imports.** `web/src/lib/*.types.ts` mirrors server shapes by hand; a changed payload fails at runtime, not at build. Update both in one change.
- **CORS.** `CORS_ORIGINS` must list the SPA origin, since every request is credentialed; unset means reflect any origin.
- **The SPA is not built or deployed by the Node image** — compose ships the API and MCP server only.
- **`/ai/*` handlers do not call `next(e)`**, relying on Express 5 promise handling, unlike every other controller.
