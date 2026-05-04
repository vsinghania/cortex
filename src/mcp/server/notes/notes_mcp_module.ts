import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpModule } from '../mcp_module.js';
import { NotesSvc } from '../../../notes_svc/notes_svc.js';
import { NoteSource, Visibility, type NoteContainer, type NoteMetadata, type NoteVectorization } from '../../../notes_svc/types/note.types.js';
import { MongooseConnectionManager } from '../../../db/mongo/mongoose_connection_manager.js';
import { DbNameResolver } from '../../../db/mongo/db_name_resolver.js';
import { logger } from '../../../common/logger.js';
import { TraceContext } from '../../../common/trace_context.js';

const zNoteSource = z.nativeEnum(NoteSource);
const zVisibility = z.nativeEnum(Visibility);

const zContainerType = z.enum(['notebook', 'database', 'folder', 'page', 'section', 'collection', 'other']);
const zNoteContainer: z.ZodType<NoteContainer> = z.object({
  container_type: zContainerType,
  container_id: z.string().min(1),
  container_name: z.string().min(1).optional()
});

const zNoteMetadata = z.object({
  provider_url: z.string().url().optional(),
  provider_etag: z.string().optional(),
  provider_last_modified: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  extra: z.record(z.unknown()).optional()
});

const zVectorizationStatus = z.enum(['none', 'pending', 'embedded', 'error']);
const zNoteVectorization = z.object({
  status: zVectorizationStatus,
  last_embedded_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  embedding_model: z.string().optional(),
  chunk_count: z.number().int().positive().optional()
});

const zNoteKey = z.object({
  source: zNoteSource,
  external_id: z.string().min(1)
});

const zListInput = z.object({
  query: z.string().optional(),
  limit: z.number().int().positive().max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0)
});

const zSearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0)
});

const zUpsertInput = z.object({
  source: zNoteSource,
  external_id: z.string().min(1),

  title: z.string().min(1),
  body_plain: z.string().default(''),
  body_markdown: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: zNoteContainer.optional(),

  created_at_provider: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  updated_at_provider: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),

  visibility: zVisibility.optional(),
  is_archived: z.boolean().optional(),
  is_deleted: z.boolean().optional(),

  metadata: zNoteMetadata.optional(),
  vectorization: zNoteVectorization.optional()
});

const zPatch = z.object({
  title: z.string().optional(),
  body_plain: z.string().optional(),
  body_markdown: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: zNoteContainer.optional(),

  created_at_provider: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  updated_at_provider: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  last_synced_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),

  visibility: zVisibility.optional(),
  is_archived: z.boolean().optional(),
  is_deleted: z.boolean().optional(),

  metadata: zNoteMetadata.optional(),
  vectorization: zNoteVectorization.optional()
}).strict();

export class NotesMcpModule extends McpModule {
  private notes_svc?: NotesSvc;

  private constructor() {
    super();
  }

  public static async create(): Promise<NotesMcpModule> {
    const mcp_module = new NotesMcpModule();
    await mcp_module.init();
    return mcp_module;
  }

  protected override async init(): Promise<void> {
    const mongo_host = process.env.MONGO_HOST ?? 'localhost';
    const mongo_port = Number(process.env.MONGO_PORT ?? 27017);
    const db = DbNameResolver.resolve('notes');

    await this.bootstrapMongo(mongo_host, mongo_port);
    this.notes_svc = await NotesSvc.create({
      db,
      host: mongo_host,
      port: mongo_port
    });
  }

  public override async cleanup(): Promise<void> {
    const mgr = MongooseConnectionManager.getExistingInstance();
    if (mgr) {
      await mgr.disconnectAll();
    }
  }

  protected override async registerTools(server: McpServer): Promise<void> {
    this.registerListTool(server);
    this.registerGetTool(server);
    this.registerUpsertTool(server);
    this.registerUpdateTool(server);
    this.registerDeleteTool(server);
    this.registerSearchTool(server);
  }

  private registerListTool(server: McpServer): void {
    server.registerTool(
      'notes.list',
      {
        title: 'List Notes',
        description: 'List notes for a user with optional text query, pagination.',
        inputSchema: zListInput.shape,
        outputSchema: {
          total: z.number(),
          items: z.array(z.any())
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const args = zListInput.parse(raw ?? {});
        const result = await this.requireNotesSvc().listNotes({ ...args, user_id });
        return NotesMcpModule.toStructuredTextResult(result);
      }
    );
  }

  private registerGetTool(server: McpServer): void {
    server.registerTool(
      'notes.get',
      {
        title: 'Get Note by Key',
        description: 'Get a note by composite key (source, external_id) for the authenticated user.',
        inputSchema: zNoteKey.shape,
        outputSchema: {
          found: z.boolean(),
          note: z.any().nullable()
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const key = zNoteKey.parse(raw ?? {});
        const note = await this.requireNotesSvc().getNoteByKey({ ...key, user_id });
        const out = { found: !!note, note: note ?? null };
        return NotesMcpModule.toStructuredTextResult(out);
      }
    );
  }

  private registerUpsertTool(server: McpServer): void {
    server.registerTool(
      'notes.upsert',
      {
        title: 'Upsert Note',
        description: 'Create or update a note by composite key.',
        inputSchema: zUpsertInput.shape,
        outputSchema: { note: z.any() }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const input = zUpsertInput.parse(raw ?? {});
        const note = await this.requireNotesSvc().upsertNote({ ...input, user_id });
        return NotesMcpModule.toStructuredTextResult({ note });
      }
    );
  }

  private registerUpdateTool(server: McpServer): void {
    server.registerTool(
      'notes.update',
      {
        title: 'Update Note (partial)',
        description: 'Update a note by composite key (partial patch).',
        inputSchema: {
          ...zNoteKey.shape,
          patch: zPatch
        },
        outputSchema: {
          found: z.boolean(),
          note: z.any().nullable()
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const key = zNoteKey.parse(raw ?? {});
        const patch = zPatch.parse((raw as any)?.patch ?? {});
        const updated = await this.requireNotesSvc().updateNoteByKey({ ...key, user_id, patch });
        const out = { found: !!updated, note: updated ?? null };
        return NotesMcpModule.toStructuredTextResult(out);
      }
    );
  }

  private registerDeleteTool(server: McpServer): void {
    server.registerTool(
      'notes.delete',
      {
        title: 'Delete Note',
        description: 'Delete a note by composite key.',
        inputSchema: zNoteKey.shape,
        outputSchema: { success: z.boolean() }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const key = zNoteKey.parse(raw ?? {});
        const success = await this.requireNotesSvc().deleteNoteByKey({ ...key, user_id });
        return NotesMcpModule.toStructuredTextResult({ success });
      }
    );
  }

  private registerSearchTool(server: McpServer): void {
    server.registerTool(
      'notes.search',
      {
        title: 'Search Notes',
        description: 'Full-text search across title/body/tags for the authenticated user.',
        inputSchema: zSearchInput.shape,
        outputSchema: {
          total: z.number(),
          items: z.array(z.any())
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const args = zSearchInput.parse(raw ?? {});
        const result = await this.requireNotesSvc().searchNotes({ ...args, user_id });
        return NotesMcpModule.toStructuredTextResult(result);
      }
    );
  }

  private async bootstrapMongo(host: string, port: number): Promise<void> {
    try {
      await MongooseConnectionManager.getInstance({ host, port });
      logger.info({ msg: 'Mongo base connection bootstrapped for MCP server', host, port });
    } catch (error) {
      logger.warn({
        msg: 'Mongo bootstrap failed for MCP server; continuing. Tools may error.',
        error: (error as Error)?.message
      });
    }
  }

  private requireNotesSvc(): NotesSvc {
    if (!this.notes_svc) {
      throw new Error('Notes service has not been initialized.');
    }

    return this.notes_svc;
  }

  private static requireUserId(): string {
    const user_id = TraceContext.getUserId();
    if (!user_id || user_id.length === 0) {
      throw new Error('Missing X-User-Id on MCP request; tool requires authenticated user.');
    }
    return user_id;
  }

  private static toStructuredTextResult<T>(result: T) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
}
