/*
 * What the notes MCP module registers and returns per caller. The module is built
 * without init() (no Mongo or Qdrant) and its services are stubbed; tool registration,
 * scope gating and payload shaping are the real code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/server';
import { NotesMcpModule } from '../src/mcp/server/notes/notes_mcp_module.js';
import { NotesMcpInstructions } from '../src/mcp/server/notes/notes_mcp_instructions.js';
import { NoteLinks } from '../src/mcp/server/notes/note_links.js';
import type { McpCaller } from '../src/mcp/server/types/mcp_server.types.js';
import { NoteSource, SyncStatus, type Note } from '../src/notes_svc/types/note.types.js';
import { Corpus, type RetrievedChunk } from '../src/retrieval_svc/types/retrieval.types.js';

type RegisteredTool = {
  config: { annotations?: Record<string, boolean>; description: string; inputSchema: { shape: Record<string, unknown> } };
  handler: (args: unknown) => Promise<{ structuredContent: any }>;
};

const READ_TOOLS = ['notes_list', 'notes_tags', 'notes_get', 'notes_search', 'notes_search_semantic', 'notes_folders'];
const WRITE_TOOLS = ['notes_create', 'notes_update', 'notes_delete', 'notes_folder_create', 'notes_bulk_update'];

const NOTE: Note = {
  id: 'note-1',
  user_id: 'user-1',
  source: NoteSource.Native,
  title: 'Trip plan',
  body: 'Pack light.',
  body_raw: 'um so pack light',
  tags: ['travel'],
  sync_status: SyncStatus.Ok,
  is_archived: false,
  is_pinned: false,
  is_deleted: false,
  vectorization: { status: 'embedded' },
  edited_at: new Date('2026-10-01T00:00:00Z'),
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z')
};

const CHUNK: RetrievedChunk = {
  chunk_id: 'chunk-9',
  document_id: 'note-1',
  corpus: Corpus.Notes,
  source: 'native',
  chunk_index: 0,
  snippet: 'Pack light.',
  score: 0.9,
  document_title: 'Trip plan'
};

function moduleWithStubs(): NotesMcpModule {
  const mcp_module = Object.create(NotesMcpModule.prototype) as NotesMcpModule;
  Object.assign(mcp_module, {
    links: NoteLinks.fromEnv({ APP_PUBLIC_URL: 'https://cortex.test' } as NodeJS.ProcessEnv),
    notes_svc: {
      getNote: async () => NOTE,
      listNotes: async () => ({ total: 1, items: [NOTE] }),
      retrieveChunks: async () => [CHUNK]
    }
  });
  return mcp_module;
}

async function registeredTools(ctx: McpCaller): Promise<Map<string, RegisteredTool>> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) {
      tools.set(name, { config, handler });
    }
  } as unknown as McpServer;
  await (moduleWithStubs() as unknown as { registerTools(s: McpServer, c: McpCaller): Promise<void> }).registerTools(server, ctx);
  return tools;
}

const CLIENT = 'https://claude.test/c.json';
const INTERNAL: McpCaller = { kind: 'internal', user_id: 'user-1' };
const EXTERNAL_READ: McpCaller = { kind: 'external', user_id: 'user-1', client_id: CLIENT, scopes: new Set(['notes:read']) };
const EXTERNAL_FULL: McpCaller = { kind: 'external', user_id: 'user-1', client_id: CLIENT, scopes: new Set(['notes:read', 'notes:write']) };
const FIRST_PARTY: McpCaller = { kind: 'first_party', user_id: 'user-1', client_id: 'cortex-voice', scopes: new Set(['notes:read', 'notes:write']) };

test('a read-only grant sees only the read tools', async () => {
  const tools = await registeredTools(EXTERNAL_READ);
  assert.deepEqual([...tools.keys()].sort(), [...READ_TOOLS].sort());
});

test('a read & write grant, first-party and internal callers see every tool', async () => {
  for (const ctx of [EXTERNAL_FULL, FIRST_PARTY, INTERNAL]) {
    const tools = await registeredTools(ctx);
    assert.deepEqual([...tools.keys()].sort(), [...READ_TOOLS, ...WRITE_TOOLS].sort());
  }
});

test('a grant with no known scopes sees nothing', async () => {
  const tools = await registeredTools({ ...EXTERNAL_READ, scopes: new Set() });
  assert.equal(tools.size, 0);
});

test('every tool states its annotations, and only delete and update are destructive', async () => {
  const tools = await registeredTools(INTERNAL);
  for (const [name, tool] of tools) {
    const annotations = tool.config.annotations;
    assert.ok(annotations, `${name} has annotations`);
    assert.equal(annotations.openWorldHint, false, name);
    if (READ_TOOLS.includes(name)) {
      assert.equal(annotations.readOnlyHint, true, name);
    } else {
      assert.equal(typeof annotations.destructiveHint, 'boolean', `${name} states destructiveHint`);
      assert.equal(annotations.destructiveHint, ['notes_delete', 'notes_update'].includes(name), name);
    }
  }
});

test('write schemas no longer accept provider keys, sync state or vectorization', async () => {
  const tools = await registeredTools(INTERNAL);
  for (const name of ['notes_create']) {
    const fields = Object.keys(tools.get(name)!.config.inputSchema.shape);
    for (const internal of ['source', 'external_id', 'vectorization', 'metadata', 'is_deleted', 'container']) {
      assert.equal(fields.includes(internal), false, `${name} exposes ${internal}`);
    }
  }
});

test('external callers get trimmed notes with a link; internal and first-party callers keep the full note', async () => {
  const external = await registeredTools(EXTERNAL_READ);
  const external_note = (await external.get('notes_get')!.handler({ locator: { id: 'note-1' } })).structuredContent.note;
  assert.equal(external_note.url, 'https://cortex.test/notes/note-1');
  for (const hidden of ['user_id', 'body_raw', 'vectorization', 'sync_status', 'is_deleted']) {
    assert.equal(hidden in external_note, false, `external note carries ${hidden}`);
  }

  const internal = await registeredTools(INTERNAL);
  const internal_note = (await internal.get('notes_get')!.handler({ locator: { id: 'note-1' } })).structuredContent.note;
  assert.equal(internal_note.url, undefined);
  assert.equal(internal_note.body_raw, 'um so pack light');

  const first_party = await registeredTools(FIRST_PARTY);
  const voice_note = (await first_party.get('notes_get')!.handler({ locator: { id: 'note-1' } })).structuredContent.note;
  assert.equal(voice_note.body_raw, 'um so pack light');
});

test('semantic chunks link to the passage for external callers only', async () => {
  const external = await registeredTools(EXTERNAL_READ);
  const [chunk] = (await external.get('notes_search_semantic')!.handler({ query: 'packing' })).structuredContent.chunks;
  assert.equal(chunk.url, 'https://cortex.test/notes/note-1?chunk=chunk-9');
  assert.equal(chunk.chunk_id, 'chunk-9');

  const internal = await registeredTools(INTERNAL);
  const [internal_chunk] = (await internal.get('notes_search_semantic')!.handler({ query: 'packing' })).structuredContent.chunks;
  assert.equal(internal_chunk.url, undefined);
});

test('only external callers are told about links in tool descriptions', async () => {
  const external = await registeredTools(EXTERNAL_READ);
  const internal = await registeredTools(INTERNAL);
  assert.match(external.get('notes_list')!.config.description, /`url`/);
  assert.doesNotMatch(internal.get('notes_list')!.config.description, /`url`/);
});

test('instructions match the grant and never prescribe a citation syntax', () => {
  const read_only = NotesMcpInstructions.buildExternalCallerInstructions({ can_write: false });
  const full = NotesMcpInstructions.buildExternalCallerInstructions({ can_write: true });
  assert.match(read_only, /read-only/);
  assert.doesNotMatch(full, /read-only/);
  assert.match(full, /`url`/);
  assert.doesNotMatch(full, /\[c:/);
});

test('a write tool registered for one caller still refuses a caller without write at invocation', async () => {
  // Simulates a registration that outlived its context: the wrapper re-checks on every call.
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) {
      tools.set(name, { config, handler });
    }
  } as unknown as McpServer;
  const mutable: McpCaller = { kind: 'external', user_id: 'user-1', client_id: CLIENT, scopes: new Set(['notes:read', 'notes:write']) };
  await (moduleWithStubs() as unknown as { registerTools(s: McpServer, c: McpCaller): Promise<void> }).registerTools(server, mutable);
  (mutable.scopes as Set<string>).delete('notes:write');
  await assert.rejects(tools.get('notes_delete')!.handler({ locator: { id: 'note-1' } }), /notes:write/);
});
