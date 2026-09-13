import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpModule } from '../mcp_module.js';
import { NotesSvc } from '../../../notes_svc/notes_svc.js';
import { NoteSource, type Note, type NoteContainer, type NoteLocator } from '../../../notes_svc/types/note.types.js';
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

const MAX_TAG_FILTER_COUNT = 10;

const zListInput = z.object({
  query: z.string().optional(),
  tags: z.array(z.string().min(1)).max(MAX_TAG_FILTER_COUNT).optional(),
  limit: z.number().int().min(0).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0)
});

const zTagsInput = z.object({
  limit: z.number().int().positive().max(200).optional().default(200)
});

const zSearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(0).max(100).optional().default(20),
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
    this.registerTagsTool(server);
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
      'notes_search_semantic',
      {
        title: 'Semantic Search Notes',
        description:
          'Search note CONTENT by semantic similarity when the user is trying to recall ' +
          'ideas, facts, decisions, opinions, or topics and their wording may differ from ' +
          'the wording in the notes. Returns ranked content chunks for grounded answers. ' +
          'Use notes_search instead when literal words or phrases matter. ' +
          'Do NOT use this tool for listing notes, counting notes, browsing recent notes, ' +
          'or retrieving an already-known note; use notes_list or notes_get instead. ' +
          'Returned chunks include stable chunk_id values that are safe to reference.',
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
      'notes_list',
      {
        title: 'List Notes',
        description: 'List and browse notes for the authenticated user, with optional filtering and pagination. ' +
          'Use this for collection-level questions such as how many notes exist, recent notes, ' +
          'listing notes, or browsing notes by source/filter. The response includes `total`, which ' +
          'is the authoritative count for the matching collection; pass `limit: 0` to get only ' +
          '`total` with no items. ' +
          'Pass `tags` to narrow to notes carrying ALL of the listed tags; tag matching ignores case. ' +
          'When a tag value is not already known to be valid, call notes_tags first to get the ' +
          'real tag list rather than guessing a spelling. ' +
          'Do NOT use this to answer questions about the meaning or contents of unknown notes; ' +
          'use notes_search or notes_search_semantic instead.',
        inputSchema: zListInput.shape,
        outputSchema: {
          total: z.number(),
          items: z.array(z.any())
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const { tags, ...args } = zListInput.parse(raw ?? {});
        const result = await this.requireNotesSvc().listNotes({
          ...args,
          user_id,
          filter: tags?.length ? { tags } : undefined
        });
        return NotesMcpModule.toStructuredTextResult(result);
      }
    );
  }

  private registerTagsTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes_tags',
      {
        title: 'List Note Tags',
        description: 'List every tag the authenticated user has, with the number of notes carrying each. ' +
          'Use this to answer questions about which tags exist or how many notes are tagged a ' +
          'certain way, and to resolve a valid tag value before calling notes_list with `tags`. ' +
          'Tags differing only by case are folded into a single row.',
        inputSchema: zTagsInput.shape,
        outputSchema: {
          tags: z.array(z.object({ tag: z.string(), count: z.number() }))
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const args = zTagsInput.parse(raw ?? {});
        const tags = await this.requireNotesSvc().listTags({ ...args, user_id });
        return NotesMcpModule.toStructuredTextResult({ tags });
      }
    );
  }

  private registerGetTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes_get',
      {
        title: 'Get Note',
        description: 'Retrieve one specific note by a known locator: { id } or { source, external_id }. ' +
          'Use this when the target note has already been identified. Do not search again when ' +
          'a valid locator for the intended note is already available.',
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
        return NotesMcpModule.toStructuredTextResult({ found: !!note, note: NotesMcpModule.toAgentNote(note) });
      }
    );
  }

  private registerCreateTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes_create',
      {
        title: 'Create Note',
        description:
          'Create a new note. Use only when the user intends to create or save a note. ' +
          'Omit source and external_id for a native in-app note; pass both for a ' +
          'source-keyed create-or-update operation.',
        inputSchema: zCreateInputBase.shape,
        outputSchema: { note: z.any() }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const input = zCreateInput.parse(raw ?? {});
        const note = await this.requireNotesSvc().createNote({ ...input, user_id });
        return NotesMcpModule.toStructuredTextResult({ note: NotesMcpModule.toAgentNote(note) });
      }
    );
  }

  private registerUpdateTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes_update',
      {
        title: 'Update Note (partial)',
        description: 'Partially update one existing note identified by locator. Use only when the user ' +
          'intends to modify a note. If the intended note is not yet identified, first resolve ' +
          'it using notes_list, notes_search, or notes_search_semantic as appropriate. ' +
          'Writing `body` replaces the note content with that markdown and discards any rich ' +
          'formatting (colors, underline, alignment) the user applied in the editor; omit `body` ' +
          'when only changing other fields.',
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
        return NotesMcpModule.toStructuredTextResult({ found: !!updated, note: NotesMcpModule.toAgentNote(updated) });
      }
    );
  }

  private registerDeleteTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes_delete',
      {
        title: 'Delete Note',
        description: 'Delete one existing note identified by locator. Use only when the user intends to ' +
          'delete a note. If the intended note is ambiguous or its locator is unknown, first ' +
          'resolve the target note.',
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
      'notes_search',
      {
        title: 'Search Notes',
        description: 'Full-text lexical search across note titles and bodies for the authenticated user. ' +
          'Use this when the user provides words, phrases, names, titles, code symbols, or other ' +
          'text expected to appear literally in a note. Prefer this over semantic search when ' +
          'exact wording matters. Use notes_search_semantic instead for conceptual recall where ' +
          'the wording may differ.',
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

  /** The rich editor document is UI-only; `body` already carries its content as markdown. */
  private static toAgentNote(note: Note | null): Omit<Note, 'body_doc' | 'body_doc_version'> | null {
    if (!note) return null;
    const { body_doc: _body_doc, body_doc_version: _body_doc_version, ...agent_note } = note;
    return agent_note;
  }

  /**
   * Compact on purpose: agent runtimes hand `content` to the model verbatim (the OpenAI
   * agents SDK drops `structuredContent` and re-encodes this text), so indentation is
   * paid for in tokens on every tool call.
   */
  private static toStructuredTextResult<T>(result: T) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result
    };
  }
}
