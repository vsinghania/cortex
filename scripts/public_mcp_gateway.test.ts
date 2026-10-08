/*
 * The MCP resource servers against fake upstreams: what reaches each internal MCP
 * server, what a caller without a valid token gets back, the per-resource metadata, and
 * the host gate that keeps them on the MCP host.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { PublicMcpGateway } from '../src/web-server/mcp/public_mcp_gateway.js';
import { HostGate } from '../src/web-server/mcp/host_gate.js';
import { McpCallerAssertion } from '../src/mcp/server/mcp_caller_assertion.js';
import { McpResourceCatalog } from '../src/mcp/resource/mcp_resource_catalog.js';
import type { McpResourceDefinition } from '../src/mcp/resource/mcp_resource.types.js';
import type { McpTokenVerifier, VerifiedMcpToken } from '../src/mcp/resource/mcp_token_verifier.js';

const SECRET = 'gateway-secret';
const MCP_BASE = 'https://mcp.cortex.test';
const NOTES = `${MCP_BASE}/notes`;
const ARTICLES = `${MCP_BASE}/articles`;

const NOTES_DEF = McpResourceCatalog.DEFINITIONS.find((d) => d.id === 'notes')!;
const ARTICLES_DEF = {
  id: 'articles',
  path: '/articles',
  display_name: 'Articles',
  scopes: { read: 'articles:read', write: 'articles:write' },
  access_copy: { read: 'Read articles.', read_write: 'Also edit articles.' },
  internal_url_env: 'MCP_ARTICLES_INTERNAL_URL',
  assertion_audience: 'cortex-articles-mcp'
} as unknown as McpResourceDefinition;

const TOKENS: Record<string, VerifiedMcpToken> = {
  cx_at_notes: { user_id: 'user-1', client_id: 'https://claude.test/c.json', grant_id: 'g-1', scopes: ['notes:read'], resource: NOTES, kind: 'external' },
  cx_at_voice: { user_id: 'user-2', client_id: 'cortex-voice', grant_id: 'g-2', scopes: ['notes:read', 'notes:write'], resource: NOTES, kind: 'first_party' },
  cx_at_articles: { user_id: 'user-1', client_id: 'https://claude.test/c.json', grant_id: 'g-3', scopes: ['articles:read'], resource: ARTICLES, kind: 'external' }
};

const verifier: McpTokenVerifier = { verify: async (token) => TOKENS[token] ?? null };

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function upstream(seen: IncomingHttpHeaders[]): Server {
  return createServer((req, res) => {
    seen.push(req.headers);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"jsonrpc":"2.0","result":{},"id":1}');
    });
  });
}

type Seen = { notes: IncomingHttpHeaders[]; articles: IncomingHttpHeaders[] };

async function withGateways(fn: (base: string, seen: Seen) => Promise<void>) {
  const seen: Seen = { notes: [], articles: [] };
  const notes_upstream = upstream(seen.notes);
  const articles_upstream = upstream(seen.articles);
  const catalog = McpResourceCatalog.create({
    base_url: new URL(MCP_BASE),
    definitions: [NOTES_DEF, ARTICLES_DEF],
    env: {
      MCP_NOTES_INTERNAL_URL: `${await listen(notes_upstream)}/mcp`,
      MCP_ARTICLES_INTERNAL_URL: `${await listen(articles_upstream)}/mcp`
    } as NodeJS.ProcessEnv
  });

  const gateways = express.Router();
  for (const resource of catalog.all()) {
    gateways.use(PublicMcpGateway.build({ verifier, resource, authorization_server_url: new URL('https://api.cortex.test'), assertion_secret: SECRET }));
  }
  const app = express();
  app.use(HostGate.for(new URL(MCP_BASE), gateways));
  app.use((_req, res) => res.status(404).end());
  const gateway = createServer(app);
  const base = await listen(gateway);

  try {
    await fn(base, seen);
  } finally {
    gateway.close();
    notes_upstream.close();
    articles_upstream.close();
  }
}

type Reply = { status: number; headers: IncomingHttpHeaders; body: string };

/** node:http rather than fetch: fetch treats Host as a forbidden header and drops it. */
function send(base: string, input: { method: 'GET' | 'POST'; path: string; host: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, method: input.method, path: input.path, headers: { host: input.host, ...(input.headers ?? {}) } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end(input.body);
  });
}

const MCP_HOST = 'mcp.cortex.test';

const post = (base: string, path: string, headers: Record<string, string>) =>
  send(base, { method: 'POST', path, host: MCP_HOST, headers: { 'content-type': 'application/json', ...headers }, body: '{"jsonrpc":"2.0","method":"tools/list","id":1}' });

const metadata = (base: string, path: string, host = MCP_HOST) => send(base, { method: 'GET', path: `/.well-known/oauth-protected-resource${path}`, host });

test('each resource serves its own RFC 9728 metadata, naming the authorization server and its scopes', async () => {
  await withGateways(async (base) => {
    const res = await metadata(base, '/notes');
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.deepEqual(JSON.parse(res.body), {
      resource: NOTES,
      authorization_servers: ['https://api.cortex.test'],
      scopes_supported: ['notes:read', 'notes:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Cortex notes'
    });
    const articles = JSON.parse((await metadata(base, '/articles')).body);
    assert.equal(articles.resource, ARTICLES);
    assert.deepEqual(articles.scopes_supported, ['articles:read', 'articles:write']);
  });
});

test('the resource servers answer only on the MCP host', async () => {
  await withGateways(async (base, seen) => {
    const on_api_host = await send(base, { method: 'POST', path: '/notes', host: 'api.cortex.test', headers: { authorization: 'Bearer cx_at_notes' } });
    assert.equal(on_api_host.status, 404);
    assert.equal((await metadata(base, '/notes', 'api.cortex.test')).status, 404);
    assert.equal(seen.notes.length, 0);

    // The same request on the MCP host does reach the resource server.
    assert.equal((await post(base, '/notes', { authorization: 'Bearer cx_at_notes' })).status, 200);
    assert.equal(seen.notes.length, 1);
  });
});

test('a missing token gets a 401 naming that resource\'s metadata and scopes', async () => {
  await withGateways(async (base, seen) => {
    const res = await post(base, '/articles', {});
    assert.equal(res.status, 401);
    const challenge = String(res.headers['www-authenticate']);
    assert.match(challenge, /resource_metadata="https:\/\/mcp\.cortex\.test\/\.well-known\/oauth-protected-resource\/articles"/);
    assert.match(challenge, /scope="articles:read articles:write"/);
    assert.equal(seen.articles.length, 0);
  });
});

test('an invalid token, or one issued for another resource, never reaches upstream', async () => {
  await withGateways(async (base, seen) => {
    for (const [path, token] of [['/notes', 'nope'], ['/notes', 'cx_at_articles'], ['/articles', 'cx_at_notes']]) {
      const res = await post(base, path, { authorization: `Bearer ${token}` });
      assert.equal(res.status, 401, `${token} at ${path}`);
      assert.match(String(res.headers['www-authenticate']), /error="invalid_token"/);
    }
    assert.equal(seen.notes.length + seen.articles.length, 0);
  });
});

test('a valid token becomes an assertion addressed to that resource\'s server; spoofed identity headers never pass', async () => {
  await withGateways(async (base, seen) => {
    const res = await post(base, '/notes', {
      authorization: 'Bearer cx_at_notes',
      'x-user-id': 'victim',
      'x-mcp-scopes': 'notes:read notes:write',
      'x-mcp-client-id': 'spoofed'
    });
    assert.equal(res.status, 200);
    const [headers] = seen.notes;
    assert.equal(headers['x-user-id'], undefined);
    assert.equal(headers['x-mcp-scopes'], undefined);
    assert.equal(headers['x-mcp-client-id'], undefined);

    const token = String(headers.authorization).replace(/^Bearer /, '');
    const caller = McpCallerAssertion.verify({ secret: SECRET, audience: 'cortex-notes-mcp', token });
    assert.equal(caller?.kind, 'external');
    assert.equal(caller?.user_id, 'user-1');
    assert.deepEqual([...caller!.scopes], ['notes:read']);
    assert.equal(McpCallerAssertion.verify({ secret: SECRET, audience: 'cortex-articles-mcp', token }), null);
  });
});

test('each resource\'s traffic goes to its own server, with its own audience', async () => {
  await withGateways(async (base, seen) => {
    await post(base, '/articles', { authorization: 'Bearer cx_at_articles' });
    assert.equal(seen.notes.length, 0);
    const token = String(seen.articles[0].authorization).replace(/^Bearer /, '');
    assert.ok(McpCallerAssertion.verify({ secret: SECRET, audience: 'cortex-articles-mcp', token }));
  });
});

test('a first-party (voice) token is asserted as first_party for its own user', async () => {
  await withGateways(async (base, seen) => {
    await post(base, '/notes', { authorization: 'Bearer cx_at_voice' });
    const token = String(seen.notes[0].authorization).replace(/^Bearer /, '');
    const caller = McpCallerAssertion.verify({ secret: SECRET, audience: 'cortex-notes-mcp', token });
    assert.equal(caller?.kind, 'first_party');
    assert.equal(caller?.user_id, 'user-2');
  });
});
