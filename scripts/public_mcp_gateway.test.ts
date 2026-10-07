/*
 * The `/mcp` resource server against a fake upstream: what reaches the internal notes MCP
 * server, what a caller without a valid token gets back, and the protected-resource metadata.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { PublicMcpGateway } from '../src/web-server/mcp/public_mcp_gateway.js';
import { McpCallerAssertion } from '../src/mcp/server/mcp_caller_assertion.js';
import type { McpTokenVerifier, VerifiedMcpToken } from '../src/mcp/resource/mcp_token_verifier.js';

const SECRET = 'gateway-secret';
const RESOURCE = 'https://api.cortex.test/mcp';
const TOKENS: Record<string, VerifiedMcpToken> = {
  cx_at_valid: { user_id: 'user-1', client_id: 'https://claude.test/c.json', grant_id: 'g-1', scopes: ['notes:read'], resource: RESOURCE, kind: 'external' },
  cx_at_voice: { user_id: 'user-2', client_id: 'cortex-voice', grant_id: 'g-2', scopes: ['notes:read', 'notes:write'], resource: RESOURCE, kind: 'first_party' },
  cx_at_elsewhere: { user_id: 'user-1', client_id: 'c', grant_id: 'g-3', scopes: ['notes:read'], resource: 'https://other.test/mcp', kind: 'external' }
};

const verifier: McpTokenVerifier = { verify: async (token) => TOKENS[token] ?? null };

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function withGateway(fn: (base: string, seen: IncomingHttpHeaders[]) => Promise<void>) {
  const seen: IncomingHttpHeaders[] = [];
  const upstream = createServer((req, res) => {
    seen.push(req.headers);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"jsonrpc":"2.0","result":{},"id":1}');
    });
  });
  const upstream_url = await listen(upstream);

  const app = express();
  app.use(
    PublicMcpGateway.build({
      verifier,
      mcp_resource_url: new URL(RESOURCE),
      authorization_server_url: new URL('https://api.cortex.test'),
      scopes: ['notes:read', 'notes:write'],
      internal_url: `${upstream_url}/mcp`,
      assertion_secret: SECRET
    })
  );
  const gateway = createServer(app);
  const base = await listen(gateway);

  try {
    await fn(base, seen);
  } finally {
    gateway.close();
    upstream.close();
  }
}

const post = (base: string, headers: Record<string, string>) =>
  fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"jsonrpc":"2.0","method":"tools/list","id":1}' });

test('serves RFC 9728 metadata naming the resource, its authorization server and scopes', async () => {
  await withGateway(async (base) => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await res.json(), {
      resource: RESOURCE,
      authorization_servers: ['https://api.cortex.test'],
      scopes_supported: ['notes:read', 'notes:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Cortex notes'
    });
  });
});

test('a missing token gets a 401 naming the metadata and the scopes to ask for', async () => {
  await withGateway(async (base, seen) => {
    const res = await post(base, {});
    assert.equal(res.status, 401);
    const challenge = res.headers.get('www-authenticate')!;
    assert.match(challenge, /resource_metadata="https:\/\/api\.cortex\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
    assert.match(challenge, /scope="notes:read notes:write"/);
    assert.equal(seen.length, 0);
  });
});

test('an invalid token, or one issued for another resource, never reaches upstream', async () => {
  await withGateway(async (base, seen) => {
    for (const token of ['nope', 'cx_at_elsewhere']) {
      const res = await post(base, { authorization: `Bearer ${token}` });
      assert.equal(res.status, 401, token);
      assert.match(res.headers.get('www-authenticate')!, /error="invalid_token"/);
    }
    assert.equal(seen.length, 0);
  });
});

test('a valid token becomes a signed assertion; spoofed identity headers never pass through', async () => {
  await withGateway(async (base, seen) => {
    const res = await post(base, {
      authorization: 'Bearer cx_at_valid',
      'x-user-id': 'victim',
      'x-mcp-scopes': 'notes:read notes:write',
      'x-mcp-client-id': 'spoofed'
    });
    assert.equal(res.status, 200);
    const [headers] = seen;
    assert.equal(headers['x-user-id'], undefined);
    assert.equal(headers['x-mcp-scopes'], undefined);
    assert.equal(headers['x-mcp-client-id'], undefined);

    const caller = McpCallerAssertion.verify({ secret: SECRET, token: String(headers.authorization).replace(/^Bearer /, '') });
    assert.equal(caller?.kind, 'external');
    assert.equal(caller?.user_id, 'user-1');
    assert.deepEqual([...caller!.scopes], ['notes:read']);
  });
});

test('a first-party (voice) token is asserted as first_party for its own user', async () => {
  await withGateway(async (base, seen) => {
    await post(base, { authorization: 'Bearer cx_at_voice' });
    const caller = McpCallerAssertion.verify({ secret: SECRET, token: String(seen[0].authorization).replace(/^Bearer /, '') });
    assert.equal(caller?.kind, 'first_party');
    assert.equal(caller?.user_id, 'user-2');
  });
});
