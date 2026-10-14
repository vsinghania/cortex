/*
 * The notes MCP module's tool surface on SDK v2. Built without init() (no Mongo or Qdrant)
 * with its services stubbed; registration and handlers are the real code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/server';
import { NotesMcpModule } from '../src/mcp/server/notes/notes_mcp_module.js';
import { McpCallers } from '../src/mcp/server/mcp_caller.js';
import type { McpCaller } from '../src/mcp/server/types/mcp_server.types.js';
import { z } from 'zod';

type RegisteredTool = {
  config: { inputSchema: z.ZodObject; outputSchema: z.ZodObject };
  handler: (args: unknown) => Promise<{ structuredContent: any }>;
};

const ALL_TOOLS = [
  'notes_list', 'notes_tags', 'notes_get', 'notes_create', 'notes_update', 'notes_delete',
  'notes_search', 'notes_search_semantic', 'notes_folders', 'notes_folder_create', 'notes_bulk_update'
];

function registeredTools(caller: McpCaller, seen_user_ids: string[] = []): Map<string, RegisteredTool> {
  const mcp_module = Object.create(NotesMcpModule.prototype) as NotesMcpModule;
  Object.assign(mcp_module, {
    notes_svc: {
      listNotes: async (params: { user_id: string }) => {
        seen_user_ids.push(params.user_id);
        return { total: 0, items: [] };
      }
    },
    folders_svc: {
      listFolderTree: async (params: { user_id: string }) => {
        seen_user_ids.push(params.user_id);
        return [
          { id: 'work', path: ['Work'], description: 'Projects and meetings.', note_count: 2 },
          { id: 'legacy', path: ['Legacy'], note_count: 0 }
        ];
      },
      ensureFolderPath: async (params: { user_id: string; path: string; description?: string }) => {
        seen_user_ids.push(params.user_id);
        return { folder: { id: 'new-folder', description: params.description }, path: params.path.split('/'), created_count: 1 };
      }
    }
  });
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) {
      tools.set(name, { config, handler });
    }
  } as unknown as McpServer;
  void (mcp_module as unknown as { registerTools(s: McpServer, c: McpCaller): Promise<void> }).registerTools(server, caller);
  return tools;
}

test('an internal caller is offered every notes tool', () => {
  assert.deepEqual([...registeredTools({ kind: 'internal', user_id: 'u-1' }).keys()].sort(), [...ALL_TOOLS].sort());
});

test('tools act for the authenticated caller, and refuse a caller with no user', async () => {
  const seen: string[] = [];
  const tools = registeredTools({ kind: 'internal', user_id: 'u-1' }, seen);
  const result = await tools.get('notes_list')!.handler({ limit: 1 });
  assert.equal(result.structuredContent.total, 0);
  assert.deepEqual(seen, ['u-1']);

  const anonymous = registeredTools({ kind: 'internal' });
  await assert.rejects(anonymous.get('notes_list')!.handler({}), /not signed in/);
});

test('tool schemas are full zod objects, as SDK v2 requires', () => {
  const tools = registeredTools({ kind: 'internal', user_id: 'u-1' });
  assert.ok('title' in tools.get('notes_create')!.config.inputSchema.shape);
});

test('AI assistants receive folder descriptions including an empty description for legacy folders', async () => {
  const seen: string[] = [];
  const tool = registeredTools({ kind: 'internal', user_id: 'u-1' }, seen).get('notes_folders')!;
  const result = await tool.handler({});
  assert.deepEqual(tool.config.outputSchema.parse(result.structuredContent), { folders: [
    { id: 'work', path: 'Work', description: 'Projects and meetings.', note_count: 2 },
    { id: 'legacy', path: 'Legacy', description: '', note_count: 0 }
  ] });
  assert.deepEqual(seen, ['u-1']);
});

test('AI assistants can describe a newly created leaf folder and overlong descriptions are rejected', async () => {
  const tool = registeredTools({ kind: 'internal', user_id: 'u-1' }).get('notes_folder_create')!;
  const result = await tool.handler({ path: 'Work/Clients', description: '  Client notes.  ' });
  assert.deepEqual(tool.config.outputSchema.parse(result.structuredContent), {
    folder: { id: 'new-folder', path: 'Work/Clients', description: 'Client notes.' }, created_count: 1
  });
  await assert.rejects(tool.handler({ path: 'Work', description: 'x'.repeat(1001) }));
});

test('authInfo carries an internal caller to the server factory and nothing else becomes one', () => {
  assert.deepEqual(McpCallers.fromSdkAuthInfo(McpCallers.toSdkAuthInfo({ kind: 'internal', user_id: 'u-1' })), { kind: 'internal', user_id: 'u-1' });
  assert.equal(McpCallers.fromSdkAuthInfo(undefined), null);
  assert.equal(McpCallers.fromSdkAuthInfo({ token: 't', clientId: 'c', scopes: [] }), null);
});
