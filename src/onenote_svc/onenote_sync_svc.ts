import { createHash } from 'node:crypto';
import { BadRequestError, NotFoundError } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { HtmlToMarkdown } from '../lib/text/html_to_markdown.js';
import { Time } from '../lib/time.js';
import { NoteFoldersSvc } from '../notes_svc/note_folders_svc.js';
import { NotesSvc } from '../notes_svc/notes_svc.js';
import { NoteSource, SyncStatus } from '../notes_svc/types/note.types.js';
import type { Note } from '../notes_svc/types/note.types.js';
import type { NoteFolder } from '../notes_svc/types/note_folder.types.js';
import { OneNoteConnectionSvc } from './onenote_connection_svc.js';
import {
  GraphForbiddenError,
  GraphRequestFailedError,
  GraphThrottledError,
  OneNoteReauthRequiredError
} from './onenote_errors.js';
import type { GraphOneNoteAdapterInterface } from './adapters/graph_onenote_adapter_interface.js';
import type { GraphPage, GraphSection } from './types/graph.types.js';
import type { OneNoteConnection, OneNoteNotebookState } from './types/onenote_connection.types.js';
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

    const targets = OneNoteSyncSvc.targetNotebooks(connection, params.notebook_ids);
    const sections_by_notebook = await this.sectionsByNotebook({ graph, targets, signal: params.signal });

    const stats: OneNoteSyncStats = {
      notebooks: targets.length,
      sections: [...sections_by_notebook.values()].reduce((total, list) => total + list.length, 0),
      pages_seen: params.checkpoint?.pages_seen ?? 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      sections_skipped: 0
    };

    const folder_cache = new Map<string, NoteFolder>();
    let checkpoint: OneNoteSyncCheckpoint = { ...params.checkpoint };

    for (const notebook of OneNoteSyncSvc.remainingById(targets, checkpoint.notebook_cursor)) {
     try {
      // Published so the card can light up this notebook alone, rather than every
      // selected one, while the pass works through them in turn.
      checkpoint = { ...checkpoint, current_notebook_id: notebook.id };
      params.onCheckpoint?.(checkpoint);

      const sections = sections_by_notebook.get(notebook.id) ?? [];
      const modified_after = params.mode === 'full' ? undefined : OneNoteSyncSvc.windowStart(notebook);
      // Each notebook keeps its own high-water mark, so finishing one says nothing about
      // how far the others have been read.
      let watermark = OneNoteSyncSvc.toDate(checkpoint.watermark_candidate) ?? notebook.sync_watermark;

      for (const section of OneNoteSyncSvc.remainingById(sections, checkpoint.section_cursor)) {
       // A section Cortex may not read - a password-protected one, most often - is not a
       // reason to abandon the pass: it is recorded and stepped over.
       try {
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
            notebook_cursor: checkpoint.notebook_cursor,
            section_cursor: checkpoint.section_cursor,
            page_next_link: next_link,
            watermark_candidate: watermark?.toISOString(),
            pages_seen: stats.pages_seen
          };

          params.onCheckpoint?.(checkpoint);
          if (!next_link) break;
          if (Time.elapsedMs(started_ms) > budget_ms) return OneNoteSyncSvc.paused(checkpoint, stats, started_ms);
        }

        // Section drained: the cursor moves, and a mid-section link must not outlive it.
        checkpoint = {
          notebook_cursor: checkpoint.notebook_cursor,
          section_cursor: section.id,
          page_next_link: undefined,
          watermark_candidate: watermark?.toISOString(),
          pages_seen: stats.pages_seen
        };
        params.onCheckpoint?.(checkpoint);
        if (Time.elapsedMs(started_ms) > budget_ms) return OneNoteSyncSvc.paused(checkpoint, stats, started_ms);
       } catch (err) {
        if (!OneNoteSyncSvc.isSkippableSection(err)) throw err;

        stats.sections_skipped += 1;
        params.onError?.({ item_id: section.id, message: `${section.display_name}: ${(err as Error).message}` });
        logger.info(
          { user_id: params.user_id, section_id: section.id, graph_code: OneNoteSyncSvc.graphCode(err) },
          'onenote section skipped'
        );

        checkpoint = {
          notebook_cursor: checkpoint.notebook_cursor,
          section_cursor: section.id,
          page_next_link: undefined,
          watermark_candidate: watermark?.toISOString(),
          pages_seen: stats.pages_seen
        };
        params.onCheckpoint?.(checkpoint);
       }
      }

      // Only a notebook read to its end may move its watermark: advancing it early would
      // permanently skip whatever the abandoned part of the walk had not reached.
      await this.deps.connection_svc.recordNotebookSynced({
        user_id: params.user_id,
        notebook_id: notebook.id,
        sync_watermark: watermark,
        last_synced_at: new Date()
      });

      checkpoint = { notebook_cursor: notebook.id, current_notebook_id: undefined, pages_seen: stats.pages_seen };
      params.onCheckpoint?.(checkpoint);
      if (Time.elapsedMs(started_ms) > budget_ms) return OneNoteSyncSvc.paused(checkpoint, stats, started_ms);
     } catch (err) {
      // Whatever ended the pass, it ended on this notebook - record it there before it
      // propagates, so the reason outlives the job row that carried it.
      if (!params.signal?.aborted) {
        await this.deps.connection_svc.recordNotebookFailed({
          user_id: params.user_id,
          notebook_id: notebook.id,
          reason: OneNoteSyncSvc.failureReason(err)
        });
      }
      throw err;
     }
    }

    await this.deps.connection_svc.recordSyncCompleted({
      user_id: params.user_id,
      last_synced_at: new Date()
    });

    logger.info(
      { user_id: params.user_id, mode: params.mode, ...stats, duration_ms: Time.elapsedMs(started_ms) },
      'onenote sync completed'
    );
    return { completed: true, stats };
  }

  /**
   * Forbidden means this section, not the grant: an encrypted OneNote section answers
   * 403 with code 20185. Gone means it was deleted between the listing and the walk.
   */
  private static isSkippableSection(err: unknown): boolean {
    if (err instanceof GraphForbiddenError) return true;
    return err instanceof GraphRequestFailedError && (err.status === 404 || err.status === 410);
  }

  /** A short code the UI turns into a sentence; the same vocabulary the job uses. */
  private static failureReason(err: unknown): string {
    if (err instanceof OneNoteReauthRequiredError) return 'reauth_required';
    if (err instanceof GraphThrottledError) return 'throttled';
    const code = OneNoteSyncSvc.graphCode(err);
    return code ? `graph_${code}` : 'sync_failed';
  }

  private static graphCode(err: unknown): string | undefined {
    if (err instanceof GraphForbiddenError || err instanceof GraphRequestFailedError) return err.graph_code;
    return undefined;
  }

  /**
   * One page, now. Small enough to answer inline — a Graph read plus an upsert — so it
   * needs no job, and it lets someone pull a single note they just edited in OneNote
   * without waiting for the next pass.
   */
  async syncNote(params: { user_id: string; note_id: string }): Promise<Note> {
    const note = await this.deps.notes_svc.getNote(params.user_id, { id: params.note_id });
    if (!note || note.source !== NoteSource.OneNote || !note.external_id) {
      throw new NotFoundError('Note not found');
    }

    const graph = this.deps.connection_svc.graphFor(params.user_id);
    const section = OneNoteSyncSvc.sectionOf(note);
    const folder = note.folder_id ? { id: note.folder_id } as NoteFolder : null;
    if (!folder) throw new BadRequestError('This note is not filed under a synced section');

    const outcome = await this.syncPage({
      params: { user_id: params.user_id, mode: 'full' },
      graph,
      page: { id: note.external_id, title: note.title, web_url: note.metadata?.provider_url },
      section,
      folder
    });
    if (outcome === 'failed') {
      // Graph 404s a page deleted in OneNote; say so rather than failing opaquely.
      throw new NotFoundError('That page is no longer in OneNote');
    }

    const updated = await this.deps.notes_svc.getNote(params.user_id, { id: params.note_id });
    if (!updated) throw new NotFoundError('Note not found');
    return updated;
  }

  /** The note already records which section it came from; reuse it rather than re-walking. */
  private static sectionOf(note: Note): GraphSection {
    return {
      id: note.container?.container_id ?? '',
      display_name: note.container?.container_name ?? '',
      notebook: null,
      section_group: null
    };
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

  /**
   * A scope narrows to notebooks already chosen for syncing; asking for one that is not
   * selected is a contradiction, not a request to sync it this once.
   */
  private static targetNotebooks(connection: OneNoteConnection, scope?: string[]): OneNoteNotebookState[] {
    const selected = new Set(connection.selected_notebook_ids);
    const wanted = scope?.length ? new Set(scope.filter((id) => selected.has(id))) : selected;

    return connection.notebooks
      .filter((n) => wanted.has(n.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** One Graph call for the whole account, then grouped; sections come with their parents. */
  private async sectionsByNotebook(args: {
    graph: GraphOneNoteAdapterInterface;
    targets: OneNoteNotebookState[];
    signal?: AbortSignal;
  }): Promise<Map<string, GraphSection[]>> {
    const wanted = new Set(args.targets.map((n) => n.id));
    const sections = await args.graph.listSections({ signal: args.signal });
    const grouped = new Map<string, GraphSection[]>();

    for (const section of sections) {
      if (!section.notebook || !wanted.has(section.notebook.id)) continue;
      const list = grouped.get(section.notebook.id) ?? [];
      list.push(section);
      grouped.set(section.notebook.id, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    return grouped;
  }

  private async requireSyncableConnection(user_id: string): Promise<OneNoteConnection> {
    const connection = await this.deps.connection_svc.getStoredConnection(user_id);
    if (!connection) throw new NotFoundError('OneNote is not connected');
    if (connection.selected_notebook_ids.length === 0) {
      throw new BadRequestError('Choose at least one notebook to sync');
    }
    return connection;
  }

  private static windowStart(notebook: OneNoteNotebookState): Date | undefined {
    if (!notebook.sync_watermark) return undefined;
    return new Date(notebook.sync_watermark.getTime() - WATERMARK_OVERLAP_MS);
  }

  /** Everything after the cursor, in id order. */
  private static remainingById<T extends { id: string }>(items: T[], cursor?: string): T[] {
    if (!cursor) return items;
    const at = items.findIndex((item) => item.id === cursor);
    // An unknown cursor means that item is gone; restarting the walk is safe because
    // every write is an upsert.
    return at < 0 ? items : items.slice(at + 1);
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
