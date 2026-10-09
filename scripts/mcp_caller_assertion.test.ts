/*
 * The gateway-to-notes-server assertion, and how a caller's scopes are judged.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { McpCallerAssertion } from '../src/mcp/server/mcp_caller_assertion.js';
import { McpCallers } from '../src/mcp/server/mcp_caller.js';
import type { McpGatewayCaller } from '../src/mcp/server/types/mcp_server.types.js';

const SECRET = 'assertion-secret';
const AUDIENCE = 'cortex-notes-mcp';
const CALLER: McpGatewayCaller = { kind: 'external', user_id: 'u-1', client_id: 'https://claude.test/c.json', scopes: new Set(['notes:read']) };

test('a signed assertion round-trips to the same caller', () => {
  const verified = McpCallerAssertion.verifyGatewayCallerAssertion({ secret: SECRET, audience: AUDIENCE, token: McpCallerAssertion.signGatewayCallerAssertion({ secret: SECRET, audience: AUDIENCE, caller: CALLER }) });
  assert.equal(verified?.kind, 'external');
  assert.equal(verified?.user_id, 'u-1');
  assert.equal(verified?.client_id, CALLER.client_id);
  assert.deepEqual([...verified!.scopes], ['notes:read']);
});

test('another secret, another audience, an expired token or a non-JWT is no caller at all', () => {
  const token = McpCallerAssertion.signGatewayCallerAssertion({ secret: SECRET, audience: AUDIENCE, caller: CALLER });
  assert.equal(McpCallerAssertion.verifyGatewayCallerAssertion({ secret: 'other', audience: AUDIENCE, token }), null);
  assert.equal(McpCallerAssertion.verifyGatewayCallerAssertion({ secret: SECRET, audience: AUDIENCE, token: 'not-a-jwt' }), null);
  assert.equal(
    McpCallerAssertion.verifyGatewayCallerAssertion({ secret: SECRET, audience: 'cortex-articles-mcp', token }),
    null,
    'an assertion addressed to one MCP server is refused by another'
  );

  const wrong_audience = jwt.sign({ client_id: 'c', scope: 'notes:write', kind: 'external' }, SECRET, { subject: 'u', issuer: 'cortex-mcp-gateway', audience: 'something-else' });
  assert.equal(McpCallerAssertion.verifyGatewayCallerAssertion({ secret: SECRET, audience: AUDIENCE, token: wrong_audience }), null);

  const expired = jwt.sign({ client_id: 'c', scope: 'notes:write', kind: 'external', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET, { subject: 'u', issuer: 'cortex-mcp-gateway', audience: 'cortex-notes-mcp' });
  assert.equal(McpCallerAssertion.verifyGatewayCallerAssertion({ secret: SECRET, audience: AUDIENCE, token: expired }), null);

  const internal_claim = jwt.sign({ client_id: 'c', scope: '', kind: 'internal' }, SECRET, { subject: 'u', issuer: 'cortex-mcp-gateway', audience: 'cortex-notes-mcp' });
  assert.equal(McpCallerAssertion.verifyGatewayCallerAssertion({ secret: SECRET, audience: AUDIENCE, token: internal_claim }), null, 'an assertion can never claim to be internal');
});

test('only the internal credential grants every scope; external callers get exactly their grant', () => {
  assert.equal(McpCallers.isScopeAllowedForCaller({ kind: 'internal' }, 'notes:write'), true);
  assert.equal(McpCallers.isScopeAllowedForCaller(CALLER, 'notes:read'), true);
  assert.equal(McpCallers.isScopeAllowedForCaller(CALLER, 'notes:write'), false);
  assert.equal(McpCallers.isScopeAllowedForCaller({ ...CALLER, scopes: new Set() }, 'notes:read'), false);
});

test('authInfo carries a caller to the server factory and nothing else becomes one', () => {
  const round = McpCallers.fromSdkAuthInfo(McpCallers.toSdkAuthInfo(CALLER));
  assert.equal(round?.kind, 'external');
  assert.equal(McpCallers.fromSdkAuthInfo(undefined), null);
  assert.equal(McpCallers.fromSdkAuthInfo({ token: 't', clientId: 'c', scopes: ['notes:write'] }), null);
});
