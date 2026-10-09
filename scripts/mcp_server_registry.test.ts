import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServerRegistry } from '../src/agent_svc/registry/mcp_server_registry.js';
import {
  McpServerMode,
  McpTransport,
  type McpServerManifest
} from '../src/agent_svc/types/mcp_server.types.js';

const UPDATED_AT = new Date('2026-01-01T00:00:00Z');

/** Public-hosted so building a handle opens no connection. */
function buildManifest(id: string, overrides: Partial<McpServerManifest> = {}): McpServerManifest {
  return {
    mcp_server_id: id,
    name: id,
    mode: McpServerMode.PublicHosted,
    transport: McpTransport.Http,
    http: { base_url: `https://${id}.example.com/mcp` },
    enabled: true,
    version: 1,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
    ...overrides
  };
}

/** Stands in for MongooseMcpServerRepository; listEnabled() returns whatever was set last. */
function fakeRepo(initial: McpServerManifest[]) {
  let manifests = initial;
  return {
    repo: { listEnabled: async () => manifests } as any,
    setManifests: (next: McpServerManifest[]) => {
      manifests = next;
    }
  };
}

test('refresh keeps the same handle for an unchanged server', async () => {
  const { repo } = fakeRepo([buildManifest('notes')]);
  const registry = await McpServerRegistry.create(repo);
  const [before] = registry.resolveMcpServerHandles(['notes']);

  await registry.refreshMcpServers();

  assert.equal(registry.resolveMcpServerHandles(['notes'])[0], before);
});

test('refresh rebuilds the handle when the manifest version changes', async () => {
  const { repo, setManifests } = fakeRepo([buildManifest('notes')]);
  const registry = await McpServerRegistry.create(repo);
  const [before] = registry.resolveMcpServerHandles(['notes']);

  setManifests([buildManifest('notes', { version: 2 })]);
  await registry.refreshMcpServers();

  const [after] = registry.resolveMcpServerHandles(['notes']);
  assert.ok(after);
  assert.notEqual(after, before);
});

test('refresh rebuilds the handle when updated_at changes', async () => {
  const { repo, setManifests } = fakeRepo([buildManifest('notes')]);
  const registry = await McpServerRegistry.create(repo);
  const [before] = registry.resolveMcpServerHandles(['notes']);

  setManifests([buildManifest('notes', { updated_at: new Date('2026-02-01T00:00:00Z') })]);
  await registry.refreshMcpServers();

  assert.notEqual(registry.resolveMcpServerHandles(['notes'])[0], before);
});

test('refresh drops servers that are no longer enabled', async () => {
  const { repo, setManifests } = fakeRepo([buildManifest('notes'), buildManifest('search')]);
  const registry = await McpServerRegistry.create(repo);

  setManifests([buildManifest('search')]);
  await registry.refreshMcpServers();

  assert.deepEqual(registry.resolveMcpServerHandles(['notes']), []);
  assert.deepEqual(registry.listMcpServerHandles().map((h) => h.id), ['search']);
});
