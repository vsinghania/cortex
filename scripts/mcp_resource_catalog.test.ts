/*
 * The catalog of public MCP resources: which are enabled, their canonical URLs, scopes,
 * and the resource side's own configuration.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { McpResourceCatalog } from '../src/mcp/resource/mcp_resource_catalog.js';
import { McpPublicConfigLoader } from '../src/mcp/resource/config/mcp_public_config.js';

const BASE = new URL('https://mcp.cortex.test');

test('a resource is enabled only when its internal URL is set, at base URL + path', () => {
  assert.equal(McpResourceCatalog.create({ base_url: BASE, env: {} as NodeJS.ProcessEnv }).listResources().length, 0);
  const catalog = McpResourceCatalog.create({ base_url: BASE, env: { MCP_NOTES_INTERNAL_URL: 'http://mcp-notes:3010/mcp' } as NodeJS.ProcessEnv });
  const notes = catalog.findResourceById('notes')!;
  assert.equal(notes.url, 'https://mcp.cortex.test/notes');
  assert.equal(notes.internal_url, 'http://mcp-notes:3010/mcp');
  assert.equal(notes.assertion_audience, 'cortex-notes-mcp');
});

test('the resources need only their base URL and the issuer they trust; unset, none are served', () => {
  const env = { MCP_NOTES_INTERNAL_URL: 'x' } as NodeJS.ProcessEnv;
  assert.equal(McpPublicConfigLoader.fromEnv(env), null);
  assert.equal(McpPublicConfigLoader.fromEnv({ ...env, MCP_PUBLIC_BASE_URL: '', OAUTH_ISSUER_URL: '' }), null);
  assert.equal(McpResourceCatalog.fromEnv(env).listResources().length, 0);
  assert.throws(() => McpPublicConfigLoader.fromEnv({ ...env, MCP_PUBLIC_BASE_URL: 'https://mcp.cortex.test' }), /OAUTH_ISSUER_URL/);

  const configured = { ...env, MCP_PUBLIC_BASE_URL: 'https://mcp.cortex.test', OAUTH_ISSUER_URL: 'https://api.cortex.test' };
  assert.equal(McpPublicConfigLoader.fromEnv(configured)?.authorization_server_url.href, 'https://api.cortex.test/');
  assert.equal(McpResourceCatalog.fromEnv(configured).findResourceById('notes')?.url, 'https://mcp.cortex.test/notes');
});

test('lookup by URL ignores a trailing slash and refuses anything else', () => {
  const catalog = McpResourceCatalog.create({ base_url: new URL('https://mcp.cortex.test/'), env: { MCP_NOTES_INTERNAL_URL: 'x' } as NodeJS.ProcessEnv });
  assert.equal(catalog.findResourceByUrl('https://mcp.cortex.test/notes/')?.id, 'notes');
  assert.equal(catalog.findResourceByUrl('https://api.cortex.test/notes'), null);
  assert.equal(catalog.findResourceByUrl('not a url'), null);
});

test('scopes: unknown ones are dropped, empty means all, write implies read, consent never widens', () => {
  const notes = McpResourceCatalog.DEFINITIONS.find((d) => d.id === 'notes')!;
  assert.deepEqual(McpResourceCatalog.resolveRequestedResourceScopes(notes, []), ['notes:read', 'notes:write']);
  assert.deepEqual(McpResourceCatalog.resolveRequestedResourceScopes(notes, ['notes:write']), ['notes:read', 'notes:write']);
  assert.deepEqual(McpResourceCatalog.resolveRequestedResourceScopes(notes, ['articles:write', 'notes:read']), ['notes:read']);
  assert.deepEqual(McpResourceCatalog.resolveScopesForResourceAccess(notes, 'read_write', ['notes:read']), ['notes:read']);
  assert.deepEqual(McpResourceCatalog.resolveScopesForResourceAccess(notes, 'read', ['notes:read', 'notes:write']), ['notes:read']);
});
