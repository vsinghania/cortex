import type { McpServer } from '@modelcontextprotocol/server';
import { McpModule } from '../mcp_module.js';
import { NotesSvc, type NoteListFilter } from '../../../notes_svc/notes_svc.js';
import { NoteFoldersSvc } from '../../../notes_svc/note_folders_svc.js';
import { NoteListSort } from '../../../notes_svc/note_list_sort.js';
import { NoteBulkActionMapper } from '../../../notes_svc/note_bulk_action_mapper.js';
import { NoteFolderTree } from '../../../notes_svc/note_folder_tree.js';
import type { NoteBulkAction } from '../../../notes_svc/types/note_bulk.types.js';
import type { Note } from '../../../notes_svc/types/note.types.js';
import type { RetrievedChunk } from '../../../retrieval_svc/types/retrieval.types.js';
import { MongooseConnectionManager } from '../../../db/mongo/mongoose_connection_manager.js';
import { DbNameResolver } from '../../../db/mongo/db_name_resolver.js';
import { QdrantCollectionBootstrap } from '../../../db/qdrant/qdrant_collection_bootstrap.js';
import { EmbeddingsSvc } from '../../../embeddings_svc/embeddings_svc.js';
import { logger } from '../../../common/logger.js';
import { McpCallers } from '../mcp_caller.js';
import type { McpCaller } from '../types/mcp_server.types.js';
import { NoteLinks } from './note_links.js';
import { NotesMcpExternalView } from './notes_mcp_external_view.js';
import { NotesMcpContract } from './notes_mcp_contract.js';
import type { NotesMcpServices, NotesMcpListInput, NotesMcpBulkUpdateInput } from './types/notes_mcp.types.js';
import {
  zSearchSemanticInput, zListInput, zTagsInput, zGetInput, zCreateInput, zUpdateInput,
  zDeleteInput, zFoldersInput, zFolderCreateInput, zBulkUpdateInput, zSearchInput,
  zNoteListOutput, zNoteLookupOutput, UNFILED_FOLDER_ID,
  zSearchSemanticOutput, zTagsOutput, zCreateOutput, zDeleteOutput, zFoldersOutput, zFolderCreateOutput, zBulkUpdateOutput
} from './notes_mcp_schemas.js';

/**
 * MCP tool annotations: hints a host may use to decide when to ask the user before a
 * call runs. They are not a security boundary - scopes and server-side checks are -
 * and nothing here relies on a host honouring them. The spec treats a missing
 * destructiveHint as true, so every write tool states it outright.
 */
const READ_ONLY_TOOL = { readOnlyHint: true, openWorldHint: false } as const;
const ADDITIVE_WRITE_TOOL = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DESTRUCTIVE_WRITE_TOOL = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export class NotesMcpModule extends McpModule {
  private constructor(private readonly services: NotesMcpServices) {
    super();
  }

  public static fromServices(services: NotesMcpServices): NotesMcpModule {
    return new NotesMcpModule(services);
  }

  public static async create(): Promise<NotesMcpModule> {
    const mongo_host = process.env.MONGO_HOST ?? 'localhost';
    const mongo_port = Number(process.env.MONGO_PORT ?? 27017);
    const db = DbNameResolver.resolve('notes');

    await NotesMcpModule.bootstrapMongoConnection(mongo_host, mongo_port);
    await NotesMcpModule.bootstrapNoteChunksCollection();
    const svc_params = { db, host: mongo_host, port: mongo_port };
    const [notes_svc, folders_svc] = await Promise.all([
      NotesSvc.create(svc_params),
      NoteFoldersSvc.create(svc_params)
    ]);
    const links = NoteLinks.fromEnv();
    if (!links) {
      logger.warn('APP_PUBLIC_URL not set; notes returned to external MCP clients will carry no links');
    }
    return NotesMcpModule.fromServices({ notes_svc, folders_svc, links });
  }

  private static async bootstrapNoteChunksCollection(): Promise<void> {
    try {
      const dim = EmbeddingsSvc.getInstance().dimensions;
      await QdrantCollectionBootstrap.ensureCollection({ name: 'note_chunks_vec', dim });
    } catch (err) {
      logger.warn(
        { err },
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

  protected override async registerTools(server: McpServer, caller: McpCaller): Promise<void> {
    this.registerListTool(server, caller);
    this.registerTagsTool(server, caller);
    this.registerGetTool(server, caller);
    this.registerSearchTool(server, caller);
    this.registerSearchSemanticTool(server, caller);
    this.registerFoldersTool(server, caller);
    this.registerCreateTool(server, caller);
    this.registerUpdateTool(server, caller);
    this.registerDeleteTool(server, caller);
    this.registerFolderCreateTool(server, caller);
    this.registerBulkUpdateTool(server, caller);
  }

  private registerSearchSemanticTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_search_semantic',
      required_scope: NotesMcpContract.READ,
      config: {
        title: 'Semantic Search Notes',
        description: this.buildToolDescription(
          caller,
          'Search note CONTENT by semantic similarity when the user is trying to recall ' +
          'ideas, facts, decisions, opinions, or topics and their wording may differ from ' +
          'the wording in the notes. Returns ranked content chunks for grounded answers. ' +
          'Archived notes are skipped unless include_archived is true; set it only when the user ' +
          'asks about archived notes. ' +
          'Use notes_search instead when literal words or phrases matter. ' +
          'Do NOT use this tool for listing notes, counting notes, browsing recent notes, ' +
          'or retrieving an already-known note; use notes_list or notes_get instead. ' +
          'Returned chunks include stable chunk_id values that are safe to reference.',
          'Each chunk carries a `url`: a stable link that opens its note in Cortex at that passage.'
        ),
        inputSchema: zSearchSemanticInput,
        outputSchema: zSearchSemanticOutput,
        annotations: READ_ONLY_TOOL
      },
      handler: async (args) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const chunks = await this.services.notes_svc.retrieveChunks({
          user_id,
          question: args.query,
          top_k: args.top_k,
          source_filter: args.source_filter,
          include_archived: args.include_archived
        });
        return { chunks: chunks.map((chunk) => this.toCallerChunkView(caller, chunk)) };
      }
    });
  }

  private registerListTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_list',
      required_scope: NotesMcpContract.READ,
      config: {
        title: 'List Notes',
        description: this.buildToolDescription(
          caller,
          'List and browse notes for the authenticated user, with optional filtering and pagination. ' +
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
          NotesMcpModule.NOTE_URL_HINT
        ),
        inputSchema: zListInput,
        outputSchema: zNoteListOutput,
        annotations: READ_ONLY_TOOL
      },
      handler: async (args) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const result = await this.services.notes_svc.listNotes({
          user_id,
          query: args.query,
          filter: NotesMcpModule.toNoteListFilter(args),
          sort: NoteListSort.fromFieldAndOrder({ field: args.sort, order: args.order }),
          limit: args.limit,
          offset: args.offset
        });
        return {
          total: result.total,
          items: result.items.map((note) => this.toCallerNoteView(caller, note))
        };
      }
    });
  }

  private registerTagsTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_tags',
      required_scope: NotesMcpContract.READ,
      config: {
        title: 'List Note Tags',
        description: 'List every tag the authenticated user has, with the number of notes carrying each. ' +
          'Use this to answer questions about which tags exist or how many notes are tagged a ' +
          'certain way, and to resolve a valid tag value before calling notes_list with `tags`. ' +
          'Tags differing only by case are folded into a single row.',
        inputSchema: zTagsInput,
        outputSchema: zTagsOutput,
        annotations: READ_ONLY_TOOL
      },
      handler: async (args) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const tags = await this.services.notes_svc.listTags({ ...args, user_id });
        return { tags };
      }
    });
  }

  private registerGetTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_get',
      required_scope: NotesMcpContract.READ,
      config: {
        title: 'Get Note',
        description: this.buildToolDescription(
          caller,
          'Retrieve one specific note by a known locator: { id } or { source, external_id }. ' +
          'Use this when the target note has already been identified. Do not search again when ' +
          'a valid locator for the intended note is already available.',
          NotesMcpModule.NOTE_URL_HINT
        ),
        inputSchema: zGetInput,
        outputSchema: zNoteLookupOutput,
        annotations: READ_ONLY_TOOL
      },
      handler: async ({ locator }) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const note = await this.services.notes_svc.getNote(user_id, locator);
        return { found: !!note, note: note ? this.toCallerNoteView(caller, note) : null };
      }
    });
  }

  private registerCreateTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_create',
      required_scope: NotesMcpContract.WRITE,
      config: {
        title: 'Create Note',
        description: 'Create a new note. Use only when the user intends to create or save a note. ' +
          '`body` is markdown.',
        inputSchema: zCreateInput,
        outputSchema: zCreateOutput,
        annotations: ADDITIVE_WRITE_TOOL
      },
      handler: async (args) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const note = await this.services.notes_svc.createNote({ ...args, user_id });
        return { note: this.toCallerNoteView(caller, note) };
      }
    });
  }

  private registerUpdateTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_update',
      required_scope: NotesMcpContract.WRITE,
      config: {
        title: 'Update Note (partial)',
        description: 'Partially update one existing note identified by locator. Use only when the user ' +
          'intends to modify a note. If the intended note is not yet identified, first resolve ' +
          'it using notes_list, notes_search, or notes_search_semantic as appropriate. ' +
          'A `body` in the patch replaces the whole body.',
        inputSchema: zUpdateInput,
        outputSchema: zNoteLookupOutput,
        annotations: DESTRUCTIVE_WRITE_TOOL
      },
      handler: async ({ locator, patch }) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const updated = await this.services.notes_svc.updateNote(user_id, locator, patch);
        return {
          found: !!updated,
          note: updated ? this.toCallerNoteView(caller, updated) : null
        };
      }
    });
  }

  private registerDeleteTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_delete',
      required_scope: NotesMcpContract.WRITE,
      config: {
        title: 'Delete Note',
        description: 'Delete one existing note identified by locator. Use only when the user intends to ' +
          'delete a note. If the intended note is ambiguous or its locator is unknown, first ' +
          'resolve the target note.',
        inputSchema: zDeleteInput,
        outputSchema: zDeleteOutput,
        annotations: DESTRUCTIVE_WRITE_TOOL
      },
      handler: async ({ locator }) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const success = await this.services.notes_svc.deleteNote(user_id, locator);
        return { success };
      }
    });
  }

  private registerFoldersTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_folders',
      required_scope: NotesMcpContract.READ,
      config: {
        title: 'List Note Folders',
        description: 'List every note folder the authenticated user has, as `{ id, path, note_count }` rows ' +
          'ordered so parents precede children. `path` is the folder names from the top level down. ' +
          'Use this to resolve a folder id before notes_list, notes_update or notes_bulk_update, ' +
          'and to answer questions about how notes are organised.',
        inputSchema: zFoldersInput,
        outputSchema: zFoldersOutput,
        annotations: READ_ONLY_TOOL
      },
      handler: async () => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const nodes = await this.services.folders_svc.listFolderTree({ user_id });
        const folders = nodes.map((n) => ({
          id: n.id,
          path: n.path.join(NoteFolderTree.PATH_SEPARATOR),
          note_count: n.note_count
        }));
        return { folders };
      }
    });
  }

  private registerFolderCreateTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_folder_create',
      required_scope: NotesMcpContract.WRITE,
      config: {
        title: 'Create Note Folder',
        description: 'Create a note folder by path, e.g. "Work/Clients", creating any missing parent folders. ' +
          'Idempotent: an existing folder at that path is returned unchanged. Use only when the user ' +
          'wants a folder created or wants notes filed into a folder that does not exist yet. ' +
          'Folder names ignore case when matching existing folders.',
        inputSchema: zFolderCreateInput,
        outputSchema: zFolderCreateOutput,
        annotations: { ...ADDITIVE_WRITE_TOOL, idempotentHint: true }
      },
      handler: async ({ path }) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const ensured = await this.services.folders_svc.ensureFolderPath({ user_id, path });
        return {
          folder: { id: ensured.folder.id, path: ensured.path.join(NoteFolderTree.PATH_SEPARATOR) },
          created_count: ensured.created_count
        };
      }
    });
  }

  private registerBulkUpdateTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_bulk_update',
      required_scope: NotesMcpContract.WRITE,
      config: {
        title: 'Bulk Update Notes',
        description: `Apply one organising action to up to ${NoteBulkActionMapper.MAX_IDS} notes by id: ` +
          'move (into folder_id, or null to unfile), archive, unarchive, pin, unpin, add_tags, remove_tags. ' +
          'Use when the user wants several notes filed, archived, pinned or tagged at once; resolve note ' +
          'ids with notes_list or notes_search and folder ids with notes_folders first. ' +
          'This tool cannot delete notes.',
        inputSchema: zBulkUpdateInput,
        outputSchema: zBulkUpdateOutput,
        // Every action here can be undone by its opposite, and none deletes.
        annotations: ADDITIVE_WRITE_TOOL
      },
      handler: async (args) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const result = await this.services.notes_svc.bulkUpdate({
          user_id,
          ids: args.ids,
          action: NotesMcpModule.toNoteBulkAction(args)
        });
        return result;
      }
    });
  }

  private registerSearchTool(server: McpServer, caller: McpCaller): void {
    this.registerTool(server, caller, {
      name: 'notes_search',
      required_scope: NotesMcpContract.READ,
      config: {
        title: 'Search Notes',
        description: this.buildToolDescription(
          caller,
          'Full-text lexical search across note titles and bodies for the authenticated user. ' +
          'Use this when the user provides words, phrases, names, titles, code symbols, or other ' +
          'text expected to appear literally in a note. Prefer this over semantic search when ' +
          'exact wording matters. Use notes_search_semantic instead for conceptual recall where ' +
          'the wording may differ.',
          NotesMcpModule.NOTE_URL_HINT
        ),
        inputSchema: zSearchInput,
        outputSchema: zNoteListOutput,
        annotations: READ_ONLY_TOOL
      },
      handler: async (args) => {
        const user_id = McpCallers.requireCallerUserId(caller);
        const result = await this.services.notes_svc.searchNotes({ ...args, user_id });
        return {
          total: result.total,
          items: result.items.map((note) => this.toCallerNoteView(caller, note))
        };
      }
    });
  }

  private static readonly NOTE_URL_HINT = 'Each note carries a `url`: a stable link that opens it in Cortex.';

  /**
   * Links exist only for external callers, so only they are told about them. The hint
   * says what the field is, not how to cite it: a tool describes its data and the
   * calling agent decides what referencing means.
   */
  private buildToolDescription(caller: McpCaller, description: string, url_hint: string): string {
    return McpCallers.isExternalCaller(caller) && this.services.links ? `${description} ${url_hint}` : description;
  }

  /** Internal and first-party callers keep the full note they have always had; external ones get the trimmed, linked view. */
  private toCallerNoteView(caller: McpCaller, note: Note) {
    return McpCallers.isExternalCaller(caller) ? NotesMcpExternalView.toExternalNoteView(note, this.services.links) : note;
  }

  private toCallerChunkView(caller: McpCaller, chunk: RetrievedChunk) {
    return McpCallers.isExternalCaller(caller) ? NotesMcpExternalView.toExternalChunkView(chunk, this.services.links) : chunk;
  }

  private static async bootstrapMongoConnection(host: string, port: number): Promise<void> {
    try {
      await MongooseConnectionManager.getInstance({ host, port });
      logger.info({ host, port }, 'Mongo base connection bootstrapped for MCP server');
    } catch (err) {
      logger.warn({ err }, 'Mongo bootstrap failed for MCP server; continuing. Tools may error.');
    }
  }

  private static toNoteListFilter(args: NotesMcpListInput): NoteListFilter {
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
  private static toNoteBulkAction(input: NotesMcpBulkUpdateInput): NoteBulkAction {
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

}
