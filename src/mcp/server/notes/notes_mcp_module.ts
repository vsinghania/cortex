import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpModule } from '../mcp_module.js';
import { NotesSvc } from '../../../notes_svc/notes_svc.js';
import { NoteSource, type NoteContainer, type NoteLocator } from '../../../notes_svc/types/note.types.js';
import { MongooseConnectionManager } from '../../../db/mongo/mongoose_connection_manager.js';
import { DbNameResolver } from '../../../db/mongo/db_name_resolver.js';
import { QdrantCollectionBootstrap } from '../../../db/qdrant/qdrant_collection_bootstrap.js';
import { EmbeddingsSvc } from '../../../embeddings_svc/embeddings_svc.js';
import { logger } from '../../../common/logger.js';
import { TraceContext } from '../../../common/trace_context.js';

const zNoteSource = z.nativeEnum(NoteSource);

const zContainerType = z.enum(['notebook', 'database', 'folder', 'page', 'section', 'collection', 'other']);
const zNoteContainer: z.ZodType<NoteContainer> = z.object({
  container_type: zContainerType,
  container_id: z.string().min(1),
  container_name: z.string().min(1).optional()
});

const zNoteMetadata = z.object({
  provider_url: z.string().url().optional(),
  provider_etag: z.string().optional(),
  extra: z.record(z.unknown()).optional()
});

const zVectorizationStatus = z.enum(['none', 'pending', 'embedded', 'error']);
const zNoteVectorization = z.object({
  status: zVectorizationStatus,
  last_embedded_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  embedding_model: z.string().optional(),
  chunk_count: z.number().int().positive().optional()
});

const zNoteLocator: z.ZodType<NoteLocator> = z.union([
  z.object({ id: z.string().min(1) }).strict(),
  z.object({ source: zNoteSource, external_id: z.string().min(1) }).strict()
]);

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

const zSearchSemanticInput = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().max(20).optional().default(8),
  source_filter: z.array(zNoteSource).optional()
});

const zCreateInputBase = z.object({
  source: zNoteSource.optional(),
  external_id: z.string().min(1).optional(),

  title: z.string().min(1),
  body: z.string().default(''),
  body_raw: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: zNoteContainer.optional(),

  provider_created_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  provider_updated_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),

  is_archived: z.boolean().optional(),
  is_deleted: z.boolean().optional(),

  metadata: zNoteMetadata.optional(),
  vectorization: zNoteVectorization.optional()
});

const zCreateInput = zCreateInputBase.superRefine((value, ctx) => {
  const has_source = value.source !== undefined && value.source !== NoteSource.Native;
  const has_ext = value.external_id !== undefined;
  if (has_source !== has_ext) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'source and external_id must be provided together for source-keyed notes; omit both for native notes.'
    });
  }
});

const zPatch = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  body_raw: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: zNoteContainer.optional(),

  provider_created_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  provider_updated_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  last_synced_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),

  is_archived: z.boolean().optional(),
  is_deleted: z.boolean().optional(),

  metadata: zNoteMetadata.optional(),
  vectorization: zNoteVectorization.optional()
}).strict();

const zUpdateInput = z.object({
  locator: zNoteLocator,
  patch: zPatch
});

const zDeleteInput = z.object({
  locator: zNoteLocator
});

const zGetInput = z.object({
  locator: zNoteLocator
});

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
    await NotesMcpModule.bootstrapQdrantCollection();
    this.notes_svc = await NotesSvc.create({
      db,
      host: mongo_host,
      port: mongo_port
    });
  }

  private static async bootstrapQdrantCollection(): Promise<void> {
    try {
      const dim = EmbeddingsSvc.getInstance().dimensions;
      await QdrantCollectionBootstrap.ensureCollection({ name: 'note_chunks_vec', dim });
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        'Qdrant collection bootstrap failed in MCP server; semantic search will error until Qdrant is reachable'
      );
    }
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
    this.registerCreateTool(server);
    this.registerUpdateTool(server);
    this.registerDeleteTool(server);
    this.registerSearchTool(server);
    this.registerSearchSemanticTool(server);
  }

  private registerSearchSemanticTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes.search_semantic',
      {
        title: 'Semantic Search Notes',
        description:
          'Vector-search the user\'s notes for chunks relevant to a natural-language question. ' +
          'Returns ranked chunks with stable chunk_id, parent note title/source, and snippet so callers can ground answers and cite chunks inline as [c:<chunk_id>].',
        inputSchema: zSearchSemanticInput.shape,
        outputSchema: {
          chunks: z.array(z.any())
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const args = zSearchSemanticInput.parse(raw ?? {});
        const chunks = await this.requireNotesSvc().retrieveChunks({
          user_id,
          question: args.query,
          top_k: args.top_k,
          source_filter: args.source_filter
        });
        return NotesMcpModule.toStructuredTextResult({ chunks });
      }
    );
  }

  private registerListTool(server: McpServer): void {
    this.registerTool(
      server,
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
    this.registerTool(
      server,
      'notes.get',
      {
        title: 'Get Note',
        description: 'Get a note by locator: { id } or { source, external_id }, scoped to the authenticated user.',
        inputSchema: zGetInput.shape,
        outputSchema: {
          found: z.boolean(),
          note: z.any().nullable()
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const { locator } = zGetInput.parse(raw ?? {});
        const note = await this.requireNotesSvc().getNote(user_id, locator);
        return NotesMcpModule.toStructuredTextResult({ found: !!note, note: note ?? null });
      }
    );
  }

  private registerCreateTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes.create',
      {
        title: 'Create Note',
        description:
          'Create a note. Omit source and external_id for a native (in-app) note; ' +
          'pass both to create-or-update by composite key for a source-keyed note.',
        inputSchema: zCreateInputBase.shape,
        outputSchema: { note: z.any() }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const input = zCreateInput.parse(raw ?? {});
        const note = await this.requireNotesSvc().createNote({ ...input, user_id });
        return NotesMcpModule.toStructuredTextResult({ note });
      }
    );
  }

  private registerUpdateTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes.update',
      {
        title: 'Update Note (partial)',
        description: 'Update a note by locator with a partial patch.',
        inputSchema: zUpdateInput.shape,
        outputSchema: {
          found: z.boolean(),
          note: z.any().nullable()
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const { locator, patch } = zUpdateInput.parse(raw ?? {});
        const updated = await this.requireNotesSvc().updateNote(user_id, locator, patch);
        return NotesMcpModule.toStructuredTextResult({ found: !!updated, note: updated ?? null });
      }
    );
  }

  private registerDeleteTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes.delete',
      {
        title: 'Delete Note',
        description: 'Delete a note by locator.',
        inputSchema: zDeleteInput.shape,
        outputSchema: { success: z.boolean() }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const { locator } = zDeleteInput.parse(raw ?? {});
        const success = await this.requireNotesSvc().deleteNote(user_id, locator);
        return NotesMcpModule.toStructuredTextResult({ success });
      }
    );
  }

  private registerSearchTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes.search',
      {
        title: 'Search Notes',
        description: 'Full-text search across title/body for the authenticated user.',
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
