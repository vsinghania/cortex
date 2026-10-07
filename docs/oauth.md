# oauth

The public MCP: how ChatGPT, Claude and any other MCP client reach a user's data in Cortex. Cortex is both the OAuth 2.1 **authorization server** (on `api.cortexapp.me`) and the MCP **resource servers** (on `mcp.cortexapp.me`, one per MCP server: `/notes` today, articles or chats later), following the MCP 2026-07-28 authorization spec. A user pastes `https://mcp.cortexapp.me/notes` into their assistant, signs in to Cortex, picks read-only or read & write, and the assistant gets a token that reaches that one user's notes and nothing else.

Source:
- Authorization server: [src/oauth_svc/](../src/oauth_svc/), with HTTP in [oauth_server.controller.ts](../src/web-server/oauth/oauth_server.controller.ts), consent and Settings in [oauth.controller.ts](../src/web-server/oauth/oauth.controller.ts), and in the SPA [connect_page.tsx](../web/src/pages/connect_page.tsx) and [connected_apps_card.tsx](../web/src/components/settings/connected_apps_card.tsx).
- Resource servers: [public_mcp_gateway.ts](../src/web-server/mcp/public_mcp_gateway.ts), one per entry in [McpResourceCatalog](../src/mcp/resource/mcp_resource_catalog.ts), with the contract between the layers in [src/mcp/resource/](../src/mcp/resource/).
- Notes server side: [mcp_caller_assertion.ts](../src/mcp/server/mcp_caller_assertion.ts) and [mcp_caller.ts](../src/mcp/server/mcp_caller.ts).

---

## 1. The flow

```
Assistant ─POST mcp.cortexapp.me/notes ─► 401 WWW-Authenticate: resource_metadata=…/.well-known/oauth-protected-resource/notes, scope="notes:read notes:write"
          ─GET  mcp.cortexapp.me/.well-known/oauth-protected-resource/notes → { resource, authorization_servers: [api.cortexapp.me] }   RS (RFC 9728)
          ─GET  api.cortexapp.me/.well-known/oauth-authorization-server     → endpoints, S256, CIMD, iss supported                    AS (RFC 8414)
browser   ─GET  api.cortexapp.me/authorize?client_id=https://app/…/client.json&code_challenge&resource=https://mcp.cortexapp.me/notes
              └► AS fetches the client metadata document (SafeFetcher) ─► 302 cortexapp.me/connect?request=…
          SPA: sign in (or sign up) ─► consent page ─► POST /api/v1/oauth/requests/:id/approve {access}
          ─► 302 redirect_uri?code&state&iss
Assistant ─POST api.cortexapp.me/token (code + code_verifier + client_id + resource) → cx_at_… (1 h) + cx_rt_… (90 d)
          ─POST mcp.cortexapp.me/notes  Authorization: Bearer cx_at_…
              └► RS: verify ─► audience check ─► assertion addressed to the notes server ─► notes MCP :3010 (SDK v2)
                                                                                         └► tools for exactly that user and those scopes
```

## 2. Two layers, one contract

The authorization server (AS) and the resource servers (RS) both run in web-server, on different hosts, and meet only through [`McpTokenVerifier`](../src/mcp/resource/mcp_token_verifier.ts): a token in, `{ user_id, client_id, grant_id, scopes, resource, kind }` or `null` out. The RS never touches token storage, and the AS knows nothing about MCP requests. They are configured and mounted separately ([oauth_config.ts](../src/oauth_svc/config/oauth_config.ts), [mcp_public_config.ts](../src/mcp/resource/config/mcp_public_config.ts)), and host gates keep each on its own host: the AS answers only on `OAUTH_ISSUER_URL`'s host, the resource servers only on `MCP_PUBLIC_BASE_URL`'s. Locally both are `localhost`. The AS learns which resources it may issue tokens for from the [resource catalog](../src/mcp/resource/mcp_resource_catalog.ts); the RS learns its AS from `OAUTH_ISSUER_URL`.

**Multiple MCP servers.** [McpResourceCatalog](../src/mcp/resource/mcp_resource_catalog.ts) lists the public MCP servers, one entry each: path, display name, consent wording, and the scope names and assertion audience from that server's contract class. A server is enabled when its internal URL is set. The AS issues tokens only for enabled entries, and the RS mounts one gateway per entry. Adding articles is a catalog entry plus its server, not OAuth or gateway code.

- **The RS serves its own protected-resource metadata.** The AS publishes its own discovery document. The PRM's `authorization_servers` entry and the AS metadata's `issuer` are both `OAUTH_ISSUER_URL` with any trailing slash removed, and they must stay byte-identical.
- **Each RS checks audience itself.** A token whose `resource` is not that gateway's exact URL is a 401, even if the AS issued it for another of our resources (RFC 8707).
- **The notes MCP server trusts credentials, never headers.**
  - Exactly the service bearer (`MCP_NOTES_AUTH_TOKEN`) is an **internal** caller with every tool; agent runs use it.
  - A gateway-signed **caller assertion** is an **external** or **first-party** caller with its grant's scopes. It is an HS256 JWT under `MCP_GATEWAY_ASSERTION_SECRET`, addressed by audience to one MCP server (notes: `cortex-notes-mcp`), lives 60 s, and carries the user, client and scopes.
  - Anything else is a 401.
  - An assertion can never claim to be internal. A missing header never widens access.

## 3. The authorization server

All of it is our own code. MCP SDK v2 ships resource-server helpers only, and v1's `mcpAuthRouter` is the deprecated path. [OAuthAuthorizationServer](../src/oauth_svc/oauth_authorization_server.ts) holds the protocol logic, independent of HTTP; [OAuthServerController](../src/web-server/oauth/oauth_server.controller.ts) is its HTTP surface.

- **Clients are Client ID Metadata Documents only.** A client's id is the https URL of a JSON document describing it. [ClientIdMetadataResolver](../src/oauth_svc/clients/client_id_metadata_resolver.ts) fetches and validates it:
  - the document's `client_id` must equal its URL exactly;
  - `client_name` and `redirect_uris` are required;
  - only public clients (`token_endpoint_auth_method: "none"`) and the `authorization_code` grant are accepted;
  - every redirect URI must pass [OAuthRedirectUriPolicy](../src/oauth_svc/oauth_redirect_uri_policy.ts).

  Documents are cached by `Cache-Control`, clamped to 1 minute–24 hours, and not at all for `no-store`. **There is no Dynamic Client Registration**: the 2026-07-28 spec deprecates it, so clients that only do DCR cannot connect.
- **The resource is required.** `/authorize` must name one of the enabled resources' canonical URLs (`resource=https://mcp.cortexapp.me/notes`); a missing or unknown one goes back to the client as `invalid_target`. The MCP spec requires clients to send it, and with several resources a default would be a guess.
- **Grants and tokens are separate.**
  - `oauth_grants` is the lasting consent between one user, one client and **one resource**. The same app connected to Notes and to Articles holds two grants, listed and revoked separately.
  - `oauth_tokens` holds every issued token, grouped into **families**: one per code exchange, meaning one per device or install. Each refresh rotates within its family.
  - Revoking the grant ends every family. With CIMD every install of an app shares one client id, so separate families are what let a user's laptop and phone stay connected at once.
- **Each collection has one owner.** Only [OAuthAuthorizationRequests](../src/oauth_svc/oauth_authorization_requests.ts), [OAuthAuthorizationCodes](../src/oauth_svc/oauth_authorization_codes.ts), [OAuthGrants](../src/oauth_svc/oauth_grants.ts) and [OAuthTokenFamilies](../src/oauth_svc/oauth_token_families.ts) touch their repositories; the authorization server, `OAuthSvc` and the verifier go through them. Each owner keeps its collection's rules: hashing raw codes and tokens, expiry, rotation and reuse detection all live in one place. [oauth_stores.ts](../src/oauth_svc/oauth_stores.ts) hands each repository to its owner, and a layering test fails any other import.
- **Effective scopes are the token's scopes ∩ the grant's.** A later, narrower consent narrows tokens already issued.
- **Refresh rotation with reuse detection.** Claiming a refresh token is one conditional write, so of two racing refreshes exactly one wins.
  - Replaying a rotated token within 30 seconds is treated as a retry and refused.
  - Later than that, the token was copied, and its **family** is revoked. Other devices are untouched.
  - Replaying an authorization code revokes the family its first exchange created (OAuth 2.1 §4.1.2). Codes are kept ten minutes past expiry for this.
- **PKCE is S256 only.** It is checked before the code is consumed, so a wrong verifier does not burn the code.
- **`iss` on every authorization response** (RFC 9207), success and error alike, advertised as `authorization_response_iss_parameter_supported`.
- **Two kinds of `/authorize` error.** Errors about the request (missing PKCE, wrong resource, response type) go back to the client's redirect_uri. Errors about the client or the redirect_uri itself render an error page and never redirect.
- **Tokens are opaque and stored as hashes**, like refresh sessions ([auth.md](auth.md) §1), so Disconnect in Settings takes effect on the next request. The `cx_at_` / `cx_rt_` / `cx_ac_` prefixes make a leaked token recognisable.
- **Scopes are per resource** (`notes:read` / `notes:write`, later `articles:read` / …), and write implies read. A request's scopes are normalized against the resource it names, so another resource's scopes are dropped; metadata `scopes_supported` is the union across resources. Each server owns its vocabulary in its contract class ([notes_mcp_contract.ts](../src/mcp/server/notes/notes_mcp_contract.ts)).
- **First-party grants.** Voice gets a one-hour, access-only token per session under a hidden `first_party` grant for the notes resource, so the token baked into the OpenAI session reaches one user's notes for an hour. The notes server gives first-party callers the full view their prompt was written for. See [voice.md](voice.md).
- **The consent screen is server-driven.** `describeRequest` returns the resource's name and the access options with their wording from the catalog, marking read & write unavailable when the client asked only to read; the page renders them and knows nothing about any one resource.

## 4. CIMD and SSRF

Accepting URL-shaped client ids means the AS fetches URLs an untrusted party chose. [SafeFetcher](../src/lib/net/safe_fetcher.ts) is the only way it does so:

- **Allowed URLs:** https on the default port only; no credentials in the URL.
- **Address checks:**
  - It resolves DNS itself and refuses the host if **any** record is loopback, private, CGNAT, link-local (including `169.254.169.254`), multicast, reserved, documentation, ULA, IPv6 link-local, NAT64, or IPv4-mapped into any of those.
  - It connects to the exact address it checked (a pinned `lookup`), while TLS still verifies the certificate for the hostname, so DNS rebinding cannot swap the address in between.
- **Response limits:** no redirects followed; 5 s timeout; 64 KB cap; JSON content type only.

Any refusal becomes `invalid_client` for the client, and the log records the reason, never the document.

## 5. What external assistants see

Cortex's agents get their behaviour from prompts and instruction policies ([agent_svc.md](agent_svc.md) §5). An external assistant sees only what the MCP server sends, so for external callers the server adds:

- **Server instructions** ([notes_mcp_instructions.ts](../src/mcp/server/notes/notes_mcp_instructions.ts)). They explain how the tools fit together, to answer only from tool results, that note content is data, and how writes should go. A read-only grant is told it cannot write.
- **Links instead of citation markers.**
  - Every note carries `url` (`/notes/<id>`).
  - Every semantic chunk carries `url` (`/notes/<id>?chunk=<chunk_id>`), which opens the note with the passage highlighted.
  - `[c:…]` markers and their verification only exist inside Cortex chat. The descriptions say what the field is, never how to cite it.
- **Trimmed notes** ([notes_mcp_external_view.ts](../src/mcp/server/notes/notes_mcp_external_view.ts)): no `user_id`, `body_raw`, vectorization, sync or provider bookkeeping.
- **Scope enforcement twice.** A tool the grant does not cover is not registered, so it is never listed. Every invocation re-checks the scope in the tool wrapper anyway.
- **Tool annotations are hints, not security.** `readOnlyHint` on reads, and an explicit `destructiveHint` on writes (`true` only for delete and update), let a host decide when to ask the user. Nothing relies on a host doing so; the boundary is scopes, server-side checks and narrow write schemas.

## 6. Gotchas

- **Config.**
  - Needed: `OAUTH_ISSUER_URL` and `APP_PUBLIC_URL` (the AS and its consent page), `MCP_PUBLIC_BASE_URL` (the MCP host; it needs `OAUTH_ISSUER_URL`), each server's internal URL (`MCP_NOTES_INTERNAL_URL`), and `MCP_GATEWAY_ASSERTION_SECRET` on **both** web-server and every MCP server.
  - Unset config disables the feature, with a warn at startup.
  - A notes server without the assertion secret refuses every gateway request.
- **The AS and RS routes are mounted before the app-wide CORS policy and `express.json()`.** MCP clients call them from any origin with form bodies, and the gateway needs the raw MCP body stream. Moving the gateway below `express.json()` silently breaks MCP.
- **Plain http only on localhost.** claude.ai and ChatGPT need a public https URL. To test them locally, point `OAUTH_ISSUER_URL` and `MCP_PUBLIC_BASE_URL` at a tunnel (one tunnel host for both works: the host gates then pass for both).
- **CIMD cannot be tested against localhost clients.** SafeFetcher refuses loopback by design. Local end-to-end runs stub the fetch; real clients need their public document.
- **The client name on the consent screen is self-declared; the client host is not.** The page shows both, and tells the user that the host is the part to check.
- **Consent requests last 15 minutes and are single-use**, long enough to sign up on the way. Login, register and Google sign-in carry the `/connect?request=…` path through.
- **Never logged:** tokens, codes, assertions, `state`. Logged: client id and name, scopes, grant id, outcome, fetch refusal reasons. `oauth refresh reuse detected` and `oauth authorization code replay detected` at warn are the ones to alert on.
- **Rate limits:** `/authorize` 100 per 15 min per IP; `/token` and `/revoke` 60 per minute per IP; each resource 120 per minute per grant.
- **DNS and TLS:** `mcp.cortexapp.me` needs its own Route 53 record (an Alias to the same ALB) and must be covered by the ALB's certificate — see [deploy/aws.md](../deploy/aws.md).
