import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { NotesMcpModule } from '../../src/mcp/server/notes/notes_mcp_module.js';
import type { NotesMcpServices } from '../../src/mcp/server/notes/types/notes_mcp.types.js';
import type { McpCaller } from '../../src/mcp/server/types/mcp_server.types.js';

export type RegisteredTool = {
  config: Tool;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
};

export class NotesMcpHarness {
  public static async registeredTools(caller: McpCaller, t: TestContext, overrides: {
    notes_svc?: Partial<NotesMcpServices['notes_svc']>;
    folders_svc?: Partial<NotesMcpServices['folders_svc']>;
    links?: NotesMcpServices['links'];
  } = {}): Promise<Map<string, RegisteredTool>> {
    const module = NotesMcpModule.fromServices({
      notes_svc: {
        listNotes: async () => ({ total: 0, items: [] }),
        listTags: async () => [],
        getNote: async () => null,
        createNote: async () => { throw new Error('Unexpected createNote call'); },
        updateNote: async () => null,
        deleteNote: async () => false,
        bulkUpdate: async ({ action }) => ({ action: action.action, matched: 0, modified: 0 }),
        searchNotes: async () => ({ total: 0, items: [] }),
        retrieveChunks: async () => [],
        ...overrides.notes_svc
      },
      folders_svc: {
        listFolderTree: async () => [],
        ensureFolderPath: async () => { throw new Error('Unexpected ensureFolderPath call'); },
        ...overrides.folders_svc
      },
      links: overrides.links ?? null
    });
    const server = new McpServer({ name: 'notes-test', version: '1' });
    const client = new Client({ name: 'notes-test-client', version: '1' });
    t.after(async () => {
      await client.close();
      await server.close();
    });
    await module.registerCapabilities(server, caller);
    const [client_transport, server_transport] = InMemoryTransport.createLinkedPair();
    await server.connect(server_transport);
    await client.connect(client_transport);
    if (!client.getServerCapabilities()?.tools) return new Map();
    const { tools } = await client.listTools();
    return new Map(tools.map((tool) => [tool.name, {
      config: tool,
      handler: async (args) => await client.callTool({ name: tool.name, arguments: args }) as CallToolResult
    }]));
  }

  public static object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return value as Record<string, unknown>;
  }
}
