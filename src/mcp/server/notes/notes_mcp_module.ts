import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpModule } from '../mcp_module.js';
import { NotesSvc, type NoteListFilter } from '../../../notes_svc/notes_svc.js';
import { NoteFoldersSvc } from '../../../notes_svc/note_folders_svc.js';
import { NoteListSort } from '../../../notes_svc/note_list_sort.js';
import { NoteBulkActionMapper } from '../../../notes_svc/note_bulk_action_mapper.js';
import { NoteFolderTree } from '../../../notes_svc/note_folder_tree.js';
import type { NoteBulkAction } from '../../../notes_svc/types/note_bulk.types.js';
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

const MAX_TAG_FILTER_COUNT = 10;

/** Sentinel for `folder_id` that selects notes not filed in any folder. */
const UNFILED_FOLDER_ID = 'none';

const zArchived = z.enum(['exclude', 'only', 'include']);

const zListInput = z.object({
  query: z.string().optional(),
  tags: z.array(z.string().min(1)).max(MAX_TAG_FILTER_COUNT).optional(),
  folder_id: z.string().min(1).optional()
    .describe(`Folder id from notes_folders, or "${UNFILED_FOLDER_ID}" for notes not in any folder.`),
  include_subfolders: z.boolean().optional().describe('With folder_id, also include notes in nested subfolders.'),
  archived: zArchived.optional().describe('Archived notes are excluded by default.'),
  pinned: z.boolean().optional(),
  sort: z.enum(NoteListSort.FIELDS).optional(),
  order: z.enum(NoteListSort.ORDERS).optional(),
  limit: z.number().int().min(0).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0)
});

const zTagsInput = z.object({
  limit: z.number().int().positive().max(200).optional().default(200)
});

const zSearchInput = z.object({
  query: z.string().min(1),
  archived: zArchived.optional().describe('Archived notes are excluded by default.'),
  limit: z.number().int().min(0).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0)
});

const zSearchSemanticInput = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().max(20).optional().default(8),
  source_filter: z.array(zNoteSource).optional(),
  include_archived: z.boolean().optional().default(false)
});

const zCreateInputBase = z.object({
  source: zNoteSource.optional(),
  external_id: z.string().min(1).optional(),

  title: z.string().min(1),
  body: z.string().default(''),
  body_raw: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: zNoteContainer.optional(),
  folder_id: z.string().min(1).optional(),

  provider_created_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  provider_updated_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),

  is_archived: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
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
  folder_id: z.string().min(1).nullable().optional().describe('Folder id from notes_folders; null removes the note from its folder.'),

  provider_created_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  provider_updated_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  last_synced_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),

  is_archived: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
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

const zFoldersInput = z.object({});

const zFolderCreateInput = z.object({
  path: z.string().min(1).describe(
    `Slash-separated folder path such as "Work/Clients", at most ${NoteFolderTree.MAX_DEPTH} levels. ` +
    'Missing folders along the path are created; existing ones are reused.'
  )
});

const zBulkIds = z.array(z.string().min(1)).min(1).max(NoteBulkActionMapper.MAX_IDS);
const zBulkTags = z.array(z.string().min(1)).min(1).max(MAX_TAG_FILTER_COUNT);

// Flat rather than a discriminated union: MCP input schemas are a single object shape.
// Delete is deliberately absent; notes_delete stays the only destructive notes tool.
const zBulkUpdateInput = z.object({
  ids: zBulkIds,
  action: z.enum(['move', 'archive', 'unarchive', 'pin', 'unpin', 'add_tags', 'remove_tags']),
  folder_id: z.string().min(1).nullable().optional()
    .describe('Required for move: target folder id from notes_folders, or null to take notes out of folders.'),
  tags: zBulkTags.optional().describe('Required for add_tags and remove_tags.')
});

export class NotesMcpModule extends McpModule {
  private notes_svc?: NotesSvc;
  private folders_svc?: NoteFoldersSvc;

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
    const svc_params = { db, host: mongo_host, port: mongo_port };
    [this.notes_svc, this.folders_svc] = await Promise.all([
      NotesSvc.create(svc_params),
      NoteFoldersSvc.create(svc_params)
    ]);
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
    this.registerFoldersTool(server);
    this.registerFolderCreateTool(server);
    this.registerBulkUpdateTool(server);
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
          'Archived notes are skipped unless include_archived is true; set it only when the user ' +
          'asks about archived notes. ' +
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
          source_filter: args.source_filter,
          include_archived: args.include_archived
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
          'Archived notes are hidden unless `archived` is "only" or "include". Pinned notes come first. ' +
          'To list a folder, resolve its id with notes_folders rather than guessing it. ' +
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
        const args = zListInput.parse(raw ?? {});
        const result = await this.requireNotesSvc().listNotes({
          user_id,
          query: args.query,
          filter: NotesMcpModule.toListFilter(args),
          sort: NoteListSort.fromParts({ field: args.sort, order: args.order }),
          limit: args.limit,
          offset: args.offset
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
        return NotesMcpModule.toStructuredTextResult({ found: !!note, note: note ?? null });
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
        return NotesMcpModule.toStructuredTextResult({ note });
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
          'it using notes_list, notes_search, or notes_search_semantic as appropriate.',
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

  private registerFoldersTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes_folders',
      {
        title: 'List Note Folders',
        description: 'List every note folder the authenticated user has, as `{ id, path, note_count }` rows ' +
          'ordered so parents precede children. `path` is the folder names from the top level down. ' +
          'Use this to resolve a folder id before notes_list, notes_update or notes_bulk_update, ' +
          'and to answer questions about how notes are organised.',
        inputSchema: zFoldersInput.shape,
        outputSchema: {
          folders: z.array(z.object({ id: z.string(), path: z.string(), note_count: z.number() }))
        }
      },
      async () => {
        const user_id = NotesMcpModule.requireUserId();
        const nodes = await this.requireFoldersSvc().listTree({ user_id });
        const folders = nodes.map((n) => ({
          id: n.id,
          path: n.path.join(NoteFolderTree.PATH_SEPARATOR),
          note_count: n.note_count
        }));
        return NotesMcpModule.toStructuredTextResult({ folders });
      }
    );
  }

  private registerFolderCreateTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes_folder_create',
      {
        title: 'Create Note Folder',
        description: 'Create a note folder by path, e.g. "Work/Clients", creating any missing parent folders. ' +
          'Idempotent: an existing folder at that path is returned unchanged. Use only when the user ' +
          'wants a folder created or wants notes filed into a folder that does not exist yet. ' +
          'Folder names ignore case when matching existing folders.',
        inputSchema: zFolderCreateInput.shape,
        outputSchema: {
          folder: z.object({ id: z.string(), path: z.string() }),
          created_count: z.number()
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const { path } = zFolderCreateInput.parse(raw ?? {});
        const ensured = await this.requireFoldersSvc().ensurePath({ user_id, path });
        return NotesMcpModule.toStructuredTextResult({
          folder: { id: ensured.folder.id, path: ensured.path.join(NoteFolderTree.PATH_SEPARATOR) },
          created_count: ensured.created_count
        });
      }
    );
  }

  private registerBulkUpdateTool(server: McpServer): void {
    this.registerTool(
      server,
      'notes_bulk_update',
      {
        title: 'Bulk Update Notes',
        description: `Apply one organising action to up to ${NoteBulkActionMapper.MAX_IDS} notes by id: ` +
          'move (into folder_id, or null to unfile), archive, unarchive, pin, unpin, add_tags, remove_tags. ' +
          'Use when the user wants several notes filed, archived, pinned or tagged at once; resolve note ' +
          'ids with notes_list or notes_search and folder ids with notes_folders first. ' +
          'This tool cannot delete notes.',
        inputSchema: zBulkUpdateInput.shape,
        outputSchema: {
          action: z.string(),
          matched: z.number(),
          modified: z.number()
        }
      },
      async (raw: unknown) => {
        const user_id = NotesMcpModule.requireUserId();
        const input = zBulkUpdateInput.parse(raw ?? {});
        const result = await this.requireNotesSvc().bulkUpdate({
          user_id,
          ids: input.ids,
          action: NotesMcpModule.toBulkAction(input)
        });
        return NotesMcpModule.toStructuredTextResult(result);
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

  private requireFoldersSvc(): NoteFoldersSvc {
    if (!this.folders_svc) {
      throw new Error('Note folders service has not been initialized.');
    }

    return this.folders_svc;
  }

  private static toListFilter(args: z.infer<typeof zListInput>): NoteListFilter {
    return {
      tags: args.tags?.length ? args.tags : undefined,
      archived: args.archived,
      pinned: args.pinned,
      folder: args.folder_id
        ? {
            folder_id: args.folder_id === UNFILED_FOLDER_ID ? null : args.folder_id,
            include_subfolders: args.include_subfolders
          }
        : undefined
    };
  }

  /** Re-checks the fields each action needs, since the flat MCP input shape cannot express them. */
  private static toBulkAction(input: z.infer<typeof zBulkUpdateInput>): NoteBulkAction {
    switch (input.action) {
      case 'move':
        if (input.folder_id === undefined) {
          throw new Error('move requires folder_id (a folder id, or null to take notes out of folders).');
        }
        return { action: input.action, folder_id: input.folder_id };
      case 'add_tags':
      case 'remove_tags':
        if (!input.tags?.length) throw new Error(`${input.action} requires tags.`);
        return { action: input.action, tags: input.tags };
      default:
        return { action: input.action };
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
