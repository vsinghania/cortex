import assert from 'node:assert/strict';
import test from 'node:test';
import { NotesMcpHarness } from './support/notes_mcp_harness.js';
import type { TestContext } from 'node:test';
import { McpCallers } from '../src/mcp/server/mcp_caller.js';
import type { McpCaller } from '../src/mcp/server/types/mcp_server.types.js';
import type { NoteListParams } from '../src/notes_svc/notes_svc.js';

const ALL_TOOLS = [
  'notes_list', 'notes_tags', 'notes_get', 'notes_create', 'notes_update', 'notes_delete',
  'notes_search', 'notes_search_semantic', 'notes_folders', 'notes_folder_create', 'notes_bulk_update'
];

async function registeredTools(caller: McpCaller, t: TestContext, seen_user_ids: string[] = []) {
  return NotesMcpHarness.registeredTools(caller, t, { notes_svc: {
    listNotes: async (params) => {
      seen_user_ids.push(params.user_id);
      return { total: 0, items: [] };
    }
  } });
}

test('an internal caller is offered every notes tool', async (t) => {
  assert.deepEqual([...(await registeredTools({ kind: 'internal', user_id: 'u-1' }, t)).keys()].sort(), [...ALL_TOOLS].sort());
});

test('tools act for the authenticated caller, and refuse a caller with no user', async (t) => {
  const seen: string[] = [];
  const tools = await registeredTools({ kind: 'internal', user_id: 'u-1' }, t, seen);
  const result = await tools.get('notes_list')!.handler({ limit: 1 });
  assert.equal(NotesMcpHarness.object(result.structuredContent).total, 0);
  assert.deepEqual(seen, ['u-1']);

  const anonymous = await registeredTools({ kind: 'internal' }, t);
  const rejected = await anonymous.get('notes_list')!.handler({});
  assert.equal(rejected.isError, true);
  assert.match(JSON.stringify(rejected.content), /not signed in/);
});

test('tool schemas are exposed by SDK v2 as JSON object schemas', async (t) => {
  const tools = await registeredTools({ kind: 'internal', user_id: 'u-1' }, t);
  assert.ok('title' in tools.get('notes_create')!.config.inputSchema.properties!);
});

test('authInfo carries an internal caller to the server factory and nothing else becomes one', () => {
  assert.deepEqual(McpCallers.fromSdkAuthInfo(McpCallers.toSdkAuthInfo({ kind: 'internal', user_id: 'u-1' })), { kind: 'internal', user_id: 'u-1' });
  assert.equal(McpCallers.fromSdkAuthInfo(undefined), null);
  assert.equal(McpCallers.fromSdkAuthInfo({ token: 't', clientId: 'c', scopes: [] }), null);
});

test('the SDK rejects invalid inputs before calling services and applies defaults', async (t) => {
  const seen: NoteListParams[] = [];
  const tools = await NotesMcpHarness.registeredTools({ kind: 'internal', user_id: 'u-1' }, t, {
    notes_svc: { listNotes: async (params) => {
      seen.push(params);
      return { total: 0, items: [] };
    } }
  });
  for (const args of [{ limit: -1 }, { limit: '20' }, { tags: Array(11).fill('tag') }]) {
    const rejected = await tools.get('notes_list')!.handler(args);
    assert.equal(rejected.isError, true);
  }
  assert.equal(seen.length, 0);
  const result = await tools.get('notes_list')!.handler({ user_id: 'someone-else' });
  assert.equal(result.isError, undefined);
  assert.equal(seen[0].user_id, 'u-1');
  assert.equal(seen[0].limit, 20);
  assert.equal(seen[0].offset, 0);
  assert.deepEqual(result.content, [{ type: 'text', text: '{"total":0,"items":[]}' }]);
  assert.deepEqual(result.structuredContent, { total: 0, items: [] });
});

test('the SDK rejects internal patch fields while bulk actions retain their required fields', async (t) => {
  let calls = 0;
  const tools = await NotesMcpHarness.registeredTools({ kind: 'internal', user_id: 'u-1' }, t, {
    notes_svc: {
      updateNote: async () => { calls++; return null; },
      bulkUpdate: async ({ action }) => { calls++; return { action: action.action, matched: 0, modified: 0 }; }
    }
  });
  const patch = await tools.get('notes_update')!.handler({ locator: { id: 'n-1' }, patch: { vectorization: {} } });
  assert.equal(patch.isError, true);
  for (const action of ['move', 'add_tags', 'remove_tags']) {
    const rejected = await tools.get('notes_bulk_update')!.handler({ ids: ['n-1'], action });
    assert.equal(rejected.isError, true);
    assert.match(JSON.stringify(rejected.content), /requires/);
  }
  assert.equal(calls, 0);
  const moved = await tools.get('notes_bulk_update')!.handler({ ids: ['n-1'], action: 'move', folder_id: null });
  assert.equal(moved.isError, undefined);
  assert.equal(calls, 1);
});
