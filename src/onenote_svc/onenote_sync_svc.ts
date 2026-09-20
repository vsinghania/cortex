import { createHash } from 'node:crypto';
import { BadRequestError, NotFoundError } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { HtmlToMarkdown } from '../lib/text/html_to_markdown.js';
import { Time } from '../lib/time.js';
import { NoteFoldersSvc } from '../notes_svc/note_folders_svc.js';
import { NotesSvc } from '../notes_svc/notes_svc.js';
import { NoteSource, SyncStatus } from '../notes_svc/types/note.types.js';
import type { NoteFolder } from '../notes_svc/types/note_folder.types.js';
import { OneNoteConnectionSvc } from './onenote_connection_svc.js';
import type { GraphOneNoteAdapterInterface } from './adapters/graph_onenote_adapter_interface.js';
import type { GraphPage, GraphSection } from './types/graph.types.js';
import type { OneNoteConnection } from './types/onenote_connection.types.js';
import type {
  OneNoteSyncCheckpoint,
  OneNoteSyncResult,
  OneNoteSyncStats,
  RunSyncParams
} from './types/onenote_sync.types.js';

/** The folder every imported notebook hangs under, so sync output is visibly separate. */
const ROOT_FOLDER_NAME = 'OneNote';
const ROOT_EXTERNAL_ID = 'root';
/**
 * Provider clocks and write visibility are not instant, so an exact watermark boundary
 * silently drops pages. Re-reading a few is nearly free: the content hash means an
 * unchanged page costs one Graph call and no write.
 */
const WATERMARK_OVERLAP_MS = Time.minutesToMs(5);
const DEFAULT_BUDGET_MS = Time.minutesToMs(8);

type OneNoteSyncSvcDeps = {
  connection_svc: OneNoteConnectionSvc;
  notes_svc: NotesSvc;
  folders_svc: NoteFoldersSvc;
};

export class OneNoteSyncSvc {
  private constructor(private readonly deps: OneNoteSyncSvcDeps) {}

  static async create(overrides?: Partial<OneNoteSyncSvcDeps>): Promise<OneNoteSyncSvc> {
    const db = DbNameResolver.resolve('notes');
    return new OneNoteSyncSvc({
      connection_svc: overrides?.connection_svc ?? (await OneNoteConnectionSvc.create()),
      notes_svc: overrides?.notes_svc ?? (await NotesSvc.create({ db })),
      folders_svc: overrides?.folders_svc ?? (await NoteFoldersSvc.create({ db }))
    });
  }

  /**
   * One pass, bounded by a wall-clock budget. The queue runs at concurrency 1, so a long
   * sync would sit in front of every other job — including the embedding of the note the
   * user is editing. Past the budget this returns `completed: false` with a checkpoint
   * and the caller re-enqueues, which keeps a big first import a series of short jobs.
   */
  async run(params: RunSyncParams): Promise<OneNoteSyncResult> {
    const started_ms = performance.now();
    const budget_ms = params.budget_ms ?? DEFAULT_BUDGET_MS;
    const connection = await this.requireSyncableConnection(params.user_id);
    const graph = this.deps.connection_svc.graphFor(params.user_id);

    const sections = await this.selectedSections({ graph, connection, signal: params.signal });
    const stats: OneNoteSyncStats = {
      sections: sections.length,
      pages_seen: params.checkpoint?.pages_seen ?? 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0
    };

    const modified_after = params.mode === 'full' ? undefined : OneNoteSyncSvc.windowStart(connection);
    const folder_cache = new Map<string, NoteFolder>();
    let checkpoint: OneNoteSyncCheckpoint = { ...params.checkpoint };
    let watermark = OneNoteSyncSvc.toDate(params.checkpoint?.watermark_candidate) ?? connection.sync_watermark;

    for (const section of OneNoteSyncSvc.remaining(sections, checkpoint.section_cursor)) {
      const folder = await this.folderForSection({ user_id: params.user_id, section, cache: folder_cache });
      let next_link = checkpoint.page_next_link;

      for (;;) {
        params.signal?.throwIfAborted();
        const batch = await graph.listPages({
          section_id: section.id,
          modified_after,
          next_link,
          signal: params.signal
        });

        for (const page of batch.pages) {
          const outcome = await this.syncPage({ params, graph, page, section, folder });
          stats[outcome] += 1;
          stats.pages_seen += 1;
          if (page.modified_at && (!watermark || page.modified_at > watermark)) watermark = page.modified_at;
          params.onProgress?.({
            processed: stats.pages_seen,
            succeeded: stats.created + stats.updated + stats.unchanged,
            failed: stats.failed
          });
        }

        next_link = batch.next_link;
        checkpoint = {
          section_cursor: checkpoint.section_cursor,
          page_next_link: next_link,
          watermark_candidate: watermark?.toISOString(),
          pages_seen: stats.pages_seen
        };

        if (!next_link) break;
        if (Time.elapsedMs(started_ms) > budget_ms) {
          return OneNoteSyncSvc.paused(checkpoint, stats, started_ms);
        }
      }

      // Section drained: the cursor moves, and a mid-section link must not outlive it.
      checkpoint = {
        section_cursor: section.id,
        page_next_link: undefined,
        watermark_candidate: watermark?.toISOString(),
        pages_seen: stats.pages_seen
      };
      if (Time.elapsedMs(started_ms) > budget_ms) {
        return OneNoteSyncSvc.paused(checkpoint, stats, started_ms);
      }
    }

    // Only a pass that reached the end may move the watermark: advancing it early would
    // permanently skip whatever the abandoned part of the walk had not read yet.
    await this.deps.connection_svc.recordSyncCompleted({
      user_id: params.user_id,
      sync_watermark: watermark,
      last_synced_at: new Date()
    });

    logger.info(
      { user_id: params.user_id, mode: params.mode, ...stats, duration_ms: Time.elapsedMs(started_ms) },
      'onenote sync completed'
    );
    return { completed: true, stats };
  }

  private async syncPage(args: {
    params: RunSyncParams;
    graph: GraphOneNoteAdapterInterface;
    page: GraphPage;
    section: GraphSection;
    folder: NoteFolder;
  }): Promise<'created' | 'updated' | 'unchanged' | 'failed'> {
    const { params, graph, page, section, folder } = args;
    try {
      const html = await graph.getPageContent({ page_id: page.id, signal: params.signal });
      const content_hash = OneNoteSyncSvc.hash(html);
      const existing = await this.deps.notes_svc.getNote(params.user_id, {
        source: NoteSource.OneNote,
        external_id: page.id
      });

      // OneNote exposes no ETag, so metadata.provider_etag holds a hash of the HTML.
      if (existing && existing.metadata?.provider_etag === content_hash) {
        await this.deps.notes_svc.updateNote(
          params.user_id,
          { source: NoteSource.OneNote, external_id: page.id },
          { last_synced_at: new Date(), sync_status: SyncStatus.Ok }
        );
        return 'unchanged';
      }

      await this.deps.notes_svc.createNote(
        {
          user_id: params.user_id,
          source: NoteSource.OneNote,
          external_id: page.id,
          title: page.title,
          body: OneNoteSyncSvc.converter().convert(html),
          body_raw: html,
          folder_id: folder.id,
          container: {
            container_type: 'section',
            container_id: section.id,
            container_name: section.display_name
          },
          provider_created_at: page.created_at,
          provider_updated_at: page.modified_at,
          last_synced_at: new Date(),
          sync_status: SyncStatus.Ok,
          metadata: { provider_url: page.web_url, provider_etag: content_hash }
        },
        // Deferred, so a thousand pages do not each block on an embedding round trip.
        { indexing: 'deferred' }
      );
      return existing ? 'updated' : 'created';
    } catch (err) {
      if (params.signal?.aborted) throw err;
      // One unreadable page must not end the pass; it is recorded and the walk goes on.
      const message = (err as Error).message;
      params.onError?.({ item_id: page.id, message });
      logger.warn({ user_id: params.user_id, page_id: page.id, err }, 'onenote page sync failed');
      return 'failed';
    }
  }

  /** `OneNote / <notebook> / <section group?> / <section>`, resolved by provider id. */
  private async folderForSection(args: {
    user_id: string;
    section: GraphSection;
    cache: Map<string, NoteFolder>;
  }): Promise<NoteFolder> {
    const { user_id, section, cache } = args;
    const root = await this.ensureFolder({
      user_id,
      cache,
      external_id: ROOT_EXTERNAL_ID,
      name: ROOT_FOLDER_NAME,
      parent_id: null
    });

    let parent = root;
    if (section.notebook) {
      parent = await this.ensureFolder({
        user_id,
        cache,
        external_id: section.notebook.id,
        name: section.notebook.display_name,
        container_type: 'notebook',
        parent_id: parent.id
      });
    }
    if (section.section_group) {
      parent = await this.ensureFolder({
        user_id,
        cache,
        external_id: section.section_group.id,
        name: section.section_group.display_name,
        container_type: 'section_group',
        parent_id: parent.id
      });
    }
    return this.ensureFolder({
      user_id,
      cache,
      external_id: section.id,
      name: section.display_name,
      container_type: 'section',
      parent_id: parent.id
    });
  }

  /** Cached per run: resolving a path costs a query per level, and sections share ancestors. */
  private async ensureFolder(args: {
    user_id: string;
    cache: Map<string, NoteFolder>;
    external_id: string;
    name: string;
    parent_id: string | null;
    container_type?: 'notebook' | 'section_group' | 'section';
  }): Promise<NoteFolder> {
    const cached = args.cache.get(args.external_id);
    if (cached) return cached;

    const folder = await this.deps.folders_svc.ensureProviderFolder({
      user_id: args.user_id,
      source: NoteSource.OneNote,
      external_id: args.external_id,
      container_type: args.container_type,
      name: args.name || '(untitled)',
      parent_id: args.parent_id
    });
    args.cache.set(args.external_id, folder);
    return folder;
  }

  private async selectedSections(args: {
    graph: GraphOneNoteAdapterInterface;
    connection: OneNoteConnection;
    signal?: AbortSignal;
  }): Promise<GraphSection[]> {
    const chosen = new Set(args.connection.selected_notebook_ids);
    const sections = await args.graph.listSections({ signal: args.signal });
    return sections
      .filter((s) => s.notebook && chosen.has(s.notebook.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private async requireSyncableConnection(user_id: string): Promise<OneNoteConnection> {
    const connection = await this.deps.connection_svc.getStoredConnection(user_id);
    if (!connection) throw new NotFoundError('OneNote is not connected');
    if (connection.selected_notebook_ids.length === 0) {
      throw new BadRequestError('Choose at least one notebook to sync');
    }
    return connection;
  }

  private static windowStart(connection: OneNoteConnection): Date | undefined {
    if (!connection.sync_watermark) return undefined;
    return new Date(connection.sync_watermark.getTime() - WATERMARK_OVERLAP_MS);
  }

  private static remaining(sections: GraphSection[], cursor?: string): GraphSection[] {
    if (!cursor) return sections;
    const at = sections.findIndex((s) => s.id === cursor);
    // An unknown cursor means the section is gone; restarting the walk is safe because
    // every write is an upsert.
    return at < 0 ? sections : sections.slice(at + 1);
  }

  private static paused(
    checkpoint: OneNoteSyncCheckpoint,
    stats: OneNoteSyncStats,
    started_ms: number
  ): OneNoteSyncResult {
    logger.info({ ...stats, duration_ms: Time.elapsedMs(started_ms) }, 'onenote sync paused on budget');
    return { completed: false, checkpoint, stats };
  }

  private static converter(): HtmlToMarkdown {
    // Images have nowhere to live until the attachments phase, so they are dropped
    // rather than left pointing at a Graph URL that needs a bearer token.
    OneNoteSyncSvc.converter_instance ??= HtmlToMarkdown.create({ drop_images: true });
    return OneNoteSyncSvc.converter_instance;
  }

  private static converter_instance?: HtmlToMarkdown;

  private static hash(html: string): string {
    return createHash('sha256').update(html).digest('base64url');
  }

  private static toDate(iso?: string): Date | undefined {
    if (!iso) return undefined;
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? undefined : at;
  }
}
