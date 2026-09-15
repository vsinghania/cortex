import type { Note, NoteContainer, NoteLocator, NoteMetadata, NoteVectorization } from './types/note.types.js';
import { NoteSource, SyncStatus } from './types/note.types.js';
import type {
  NoteRepository,
  NoteListParams as RepoListParams,
  NoteListResult as RepoListResult,
  NoteListFilter as RepoListFilter,
  NoteTagCount as RepoTagCount,
  NoteSearchParams,
  NotePatchFields,
  NoteFolderCount
} from './repositories/note_repository_interface.js';
import type { NoteFolderRepository } from './repositories/note_folder_repository_interface.js';
import type { NoteFolder } from './types/note_folder.types.js';
import type { NoteBulkAction, NoteBulkResult } from './types/note_bulk.types.js';
import type { NoteChunkRepository } from './repositories/note_chunk_repository_interface.js';
import type { NoteChunk } from './types/note_chunk.types.js';
import { MongooseNoteRepository } from './repositories/mongoose_note_repository.js';
import { MongooseNoteChunkRepository } from './repositories/mongoose_note_chunk_repository.js';
import { MongooseNoteFolderRepository } from './repositories/mongoose_note_folder_repository.js';
import { NotePatchKind } from './note_patch_kind.js';
import { NoteBulkActionMapper } from './note_bulk_action_mapper.js';
import { NoteFolderTree } from './note_folder_tree.js';
import { NoteFilingSuggester, type NoteFilingSuggestion } from './filing/note_filing_suggester.js';
import { NotesVectorizationSvc } from './notes_vectorization_svc.js';
import { RetrievalSvc } from '../retrieval_svc/retrieval_svc.js';
import type { RawRetrievedChunk, RetrievedChunk, RetrieveParams } from '../retrieval_svc/types/retrieval.types.js';
import { Corpus } from '../retrieval_svc/types/retrieval.types.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';
import { NotFoundError } from '../common/errors.js';
import { logger } from '../common/logger.js';

export type NoteListResult = RepoListResult;
export type NoteTagCount = RepoTagCount;

/** `folder_id: null` selects unfiled notes. */
export type NoteFolderFilter = {
  folder_id: string | null;
  include_subfolders?: boolean;
};

export type NoteListFilter = Omit<RepoListFilter, 'folder_ids' | 'unfiled'> & {
  folder?: NoteFolderFilter;
};

export type NoteListParams = Omit<RepoListParams, 'filter'> & {
  filter?: NoteListFilter;
};

export type NoteCreateInput = {
  user_id: string;

  // Source-keyed path: pass both for an upsert-by-(source, external_id) create-or-update.
  // Native path: omit both; service generates an id and sets source = Native.
  source?: NoteSource;
  external_id?: string;

  title: string;
  body: string;
  body_raw?: string;
  tags?: string[];
  container?: NoteContainer;
  folder_id?: string;

  provider_created_at?: Date;
  provider_updated_at?: Date;

  is_archived?: boolean;
  is_pinned?: boolean;
  is_deleted?: boolean;

  metadata?: NoteMetadata;
  vectorization?: NoteVectorization;
};

export type NotePatch = Omit<NotePatchFields, 'id' | 'user_id' | 'source' | 'external_id' | 'created_at' | 'updated_at'>;

const DELETE_BATCH_SIZE = 500;

/**
 * NotesSvc - domain service for CRUD/search on notes.
 *
 * One verb per operation; mutating ops accept a NoteLocator that is either
 * `{ id }` (works for any note) or `{ source, external_id }` (only valid for
 * source-keyed notes). Native notes have no external_id and must be located by id.
 */
export class NotesSvc {

  private vectorization_svc?: NotesVectorizationSvc;
  private chunk_repo?: NoteChunkRepository;

  private constructor(
    private readonly notes_repo: NoteRepository,
    private readonly folder_repo: NoteFolderRepository
  ) {}

  static async create(params?: { db?: string; host?: string; port?: number }): Promise<NotesSvc> {
    const db = params?.db ?? DbNameResolver.resolve('notes');
    const [notes_repo, folder_repo] = await Promise.all([
      MongooseNoteRepository.create({ db, host: params?.host, port: params?.port }),
      MongooseNoteFolderRepository.create({ db, host: params?.host, port: params?.port })
    ]);
    return new NotesSvc(notes_repo, folder_repo);
  }

  async listNotes(params: NoteListParams): Promise<NoteListResult> {
    const filter = await this.resolveListFilter(params.user_id, params.filter);
    return this.notes_repo.listNotes({ ...params, filter });
  }

  async countNotesByFolder(params: { user_id: string }): Promise<NoteFolderCount[]> {
    return this.notes_repo.countNotesByFolder(params);
  }

  async listNoteIdsInFolders(params: { user_id: string; folder_ids: string[] }): Promise<string[]> {
    return this.notes_repo.listNoteIdsInFolders(params);
  }

  async listTags(params: { user_id: string; limit?: number }): Promise<NoteTagCount[]> {
    return this.notes_repo.listTags(params);
  }

  async getNote(user_id: string, locator: NoteLocator): Promise<Note | null> {
    if ('id' in locator) {
      return this.notes_repo.getNoteById({ user_id, id: locator.id });
    }
    return this.notes_repo.getNoteByKey({ user_id, source: locator.source, external_id: locator.external_id });
  }

  async createNote(input: NoteCreateInput): Promise<Note> {
    const start_ms = performance.now();
    if (input.folder_id) await this.requireFolder(input.user_id, input.folder_id);
    const note = NotesSvc.isSourceKeyedInput(input)
      ? await this.upsertSourceKeyed(input)
      : await this.createNative(input);
    await this.vectorizeSafely(note);
    logger.info(
      {
        note_id: note.id,
        source: note.source,
        title_chars: note.title.length,
        body_chars: note.body.length,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'note created'
    );
    return note;
  }

  async updateNote(user_id: string, locator: NoteLocator, patch: NotePatch): Promise<Note | null> {
    const start_ms = performance.now();
    if (patch.folder_id) await this.requireFolder(user_id, patch.folder_id);
    const updated = 'id' in locator
      ? await this.notes_repo.updateNoteById({ user_id, id: locator.id, patch })
      : await this.notes_repo.updateNoteByKey({
          user_id,
          source: locator.source,
          external_id: locator.external_id,
          patch
        });
    const revectorized = !!updated && NotePatchKind.touchesBody(patch);
    if (updated && revectorized) {
      await this.vectorizeSafely(updated);
    }
    if (updated && NotePatchKind.touchesArchive(patch)) {
      await this.setArchivedSafely({ user_id, note_ids: [updated.id], is_archived: updated.is_archived });
    }
    if (updated) {
      logger.info(
        {
          note_id: updated.id,
          revectorized,
          organizational: NotePatchKind.isOrganizationalOnly(patch),
          duration_ms: Time.elapsedMs(start_ms)
        },
        'note updated'
      );
    } else {
      logger.warn({ reason: 'not_found' }, 'note update missed');
    }
    return updated;
  }

  async deleteNote(user_id: string, locator: NoteLocator): Promise<boolean> {
    const start_ms = performance.now();
    const target = await this.getNote(user_id, locator);
    const deleted = 'id' in locator
      ? await this.notes_repo.deleteNoteById({ user_id, id: locator.id })
      : await this.notes_repo.deleteNoteByKey({
          user_id,
          source: locator.source,
          external_id: locator.external_id
        });
    if (deleted && target) {
      await this.removeVectorsSafely(user_id, target.id);
    }
    if (deleted) {
      logger.info(
        {
          note_id: target?.id,
          vectors_removed: !!target,
          duration_ms: Time.elapsedMs(start_ms)
        },
        'note deleted'
      );
    } else {
      logger.warn({ reason: 'not_found' }, 'note delete missed');
    }
    return deleted;
  }

  /**
   * Deletes in fixed-size batches so a large folder cascade never loads every note at once.
   * Each note keeps its trash snapshot; vector cleanup failures are logged, not thrown.
   */
  async deleteNotes(params: { user_id: string; ids: string[] }): Promise<number> {
    let deleted_count = 0;
    for (const batch of NotesSvc.toBatches(params.ids, DELETE_BATCH_SIZE)) {
      const deleted_ids = await this.notes_repo.deleteNotesByIds({ user_id: params.user_id, ids: batch });
      await this.removeVectorsForNotesSafely(params.user_id, deleted_ids);
      deleted_count += deleted_ids.length;
    }
    return deleted_count;
  }

  async bulkUpdate(params: { user_id: string; ids: string[]; action: NoteBulkAction }): Promise<NoteBulkResult> {
    const start_ms = performance.now();
    const ids = Array.from(new Set(params.ids));
    const result = await this.applyBulkAction({ ...params, ids });
    logger.info(
      {
        action: result.action,
        id_count: ids.length,
        matched: result.matched,
        modified: result.modified,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'notes bulk updated'
    );
    return result;
  }

  /** Removes one tag, ignoring case, from every note of the user. Returns notes changed. */
  async deleteTag(params: { user_id: string; tag: string }): Promise<number> {
    const start_ms = performance.now();
    const notes_updated = await this.notes_repo.removeTagEverywhere({
      user_id: params.user_id,
      tag: params.tag.trim()
    });
    logger.info({ notes_updated, duration_ms: Time.elapsedMs(start_ms) }, 'tag deleted');
    return notes_updated;
  }

  /** Suggests a folder and tags (and a title, when missing) for note content, without saving anything. */
  async suggestFiling(params: { user_id: string; title?: string; body: string }): Promise<NoteFilingSuggestion> {
    const start_ms = performance.now();
    const [folders, counts, tags] = await Promise.all([
      this.folder_repo.listFolders({ user_id: params.user_id }),
      this.notes_repo.countNotesByFolder({ user_id: params.user_id }),
      this.notes_repo.listTags({ user_id: params.user_id, limit: NoteFilingSuggester.MAX_EXISTING_TAGS })
    ]);
    const { suggestion, model } = await NoteFilingSuggester.suggest({
      title: params.title,
      body: params.body,
      folders: NoteFolderTree.buildNodes(folders, counts),
      tags
    });
    logger.info(
      {
        folder_count: folders.length,
        tag_count: tags.length,
        body_chars: params.body.length,
        model,
        title_suggested: suggestion.title !== null,
        folder_suggested: suggestion.folder !== null,
        suggested_tag_count: suggestion.tags.length,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'note filing suggested'
    );
    return suggestion;
  }

  async searchNotes(params: NoteSearchParams): Promise<NoteListResult> {
    const start_ms = performance.now();
    const result = await this.notes_repo.searchNotes(params);
    logger.info(
      {
        query_chars: params.query.length,
        result_count: result.items.length,
        limit: params.limit,
        offset: params.offset,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'notes searched'
    );
    return result;
  }

  async retrieveChunks(params: RetrieveParams): Promise<RetrievedChunk[]> {
    const start_ms = performance.now();
    const retrieval = await RetrievalSvc.getInstance();
    const raw = await retrieval.retrieve(Corpus.Notes, params);
    const chunks = raw.length === 0 ? [] : await this.decorateWithNoteTitles(params.user_id, raw);
    logger.info(
      {
        question_chars: params.question.length,
        top_k: params.top_k,
        chunk_count: chunks.length,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'chunks retrieved'
    );
    return chunks;
  }

  async getNotesByIds(params: { user_id: string; ids: string[] }): Promise<Note[]> {
    if (params.ids.length === 0) return [];
    return this.notes_repo.getNotesByIds(params);
  }

  async getChunksByIds(params: { user_id: string; ids: string[] }): Promise<NoteChunk[]> {
    if (params.ids.length === 0) return [];
    const repo = await this.chunkRepo();
    return repo.getChunksByIds(params);
  }

  /**
   * Resolves a single chunk for citation deep-links. Scoped by user in the repo query
   * and additionally checked against the note it is claimed to belong to.
   */
  async getChunk(params: { user_id: string; note_id: string; chunk_id: string }): Promise<NoteChunk | null> {
    const [chunk] = await this.getChunksByIds({ user_id: params.user_id, ids: [params.chunk_id] });
    if (!chunk || chunk.note_id !== params.note_id) return null;
    return chunk;
  }

  async revectorizeNote(params: { user_id: string; note_id: string }): Promise<NoteVectorization | null> {
    const svc = await this.vectorizationSvc();
    return svc.revectorizeNote(params);
  }

  private async applyBulkAction(params: { user_id: string; ids: string[]; action: NoteBulkAction }): Promise<NoteBulkResult> {
    const { user_id, ids, action } = params;
    if (action.action === 'delete') {
      const deleted = await this.deleteNotes({ user_id, ids });
      return { action: action.action, matched: deleted, modified: deleted };
    }
    if (action.action === 'move' && action.folder_id) {
      await this.requireFolder(user_id, action.folder_id);
    }
    const { matched, modified } = await this.notes_repo.bulkUpdateNotes({
      user_id,
      ids,
      update: NoteBulkActionMapper.toRepoUpdate(action)
    });
    const archived_state = NoteBulkActionMapper.archivedStateAfter(action);
    if (archived_state !== undefined) {
      await this.setArchivedSafely({ user_id, note_ids: ids, is_archived: archived_state });
    }
    return { action: action.action, matched, modified };
  }

  private async resolveListFilter(user_id: string, filter: NoteListFilter | undefined): Promise<RepoListFilter | undefined> {
    if (!filter) return undefined;
    const { folder, ...rest } = filter;
    if (!folder) return rest;
    if (folder.folder_id === null) return { ...rest, unfiled: true };

    const root = await this.requireFolder(user_id, folder.folder_id);
    if (!folder.include_subfolders) return { ...rest, folder_ids: [root.id] };
    const descendants = await this.folder_repo.listDescendants({ user_id, id: root.id });
    return { ...rest, folder_ids: [root.id, ...descendants.map((d) => d.id)] };
  }

  private async requireFolder(user_id: string, folder_id: string): Promise<NoteFolder> {
    const folder = await this.folder_repo.getFolder({ user_id, id: folder_id });
    if (!folder) throw new NotFoundError('Folder not found');
    return folder;
  }

  private async setArchivedSafely(params: { user_id: string; note_ids: string[]; is_archived: boolean }): Promise<void> {
    try {
      const svc = await this.vectorizationSvc();
      await svc.setArchived(params);
    } catch (err) {
      logger.warn({ err, note_count: params.note_ids.length }, 'note archive vector sync failed');
    }
  }

  private async removeVectorsForNotesSafely(user_id: string, note_ids: string[]): Promise<void> {
    try {
      const svc = await this.vectorizationSvc();
      await svc.removeVectorsForNotes({ user_id, note_ids });
    } catch (err) {
      logger.warn({ err, note_count: note_ids.length }, 'bulk note vector cleanup failed');
    }
  }

  private static toBatches<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }

  private async vectorizeSafely(note: Note): Promise<void> {
    try {
      const svc = await this.vectorizationSvc();
      await svc.vectorizeNote(note);
    } catch (err) {
      logger.warn({ err, note_id: note.id }, 'note vectorization failed');
    }
  }

  private async removeVectorsSafely(user_id: string, note_id: string): Promise<void> {
    try {
      const svc = await this.vectorizationSvc();
      await svc.removeNoteVectors({ user_id, note_id });
    } catch (err) {
      logger.warn({ err, note_id }, 'note vector cleanup failed');
    }
  }

  private async chunkRepo(): Promise<NoteChunkRepository> {
    if (!this.chunk_repo) {
      this.chunk_repo = await MongooseNoteChunkRepository.create({ db: DbNameResolver.resolve('notes') });
    }
    return this.chunk_repo;
  }

  private async vectorizationSvc(): Promise<NotesVectorizationSvc> {
    if (!this.vectorization_svc) {
      this.vectorization_svc = await NotesVectorizationSvc.create();
    }
    return this.vectorization_svc;
  }

  private async decorateWithNoteTitles(
    user_id: string,
    raw: RawRetrievedChunk[]
  ): Promise<RetrievedChunk[]> {
    const unique_ids = Array.from(new Set(raw.map((r) => r.document_id)));
    const notes = await this.notes_repo.getNotesByIds({ user_id, ids: unique_ids });
    const title_by_id = new Map(notes.map((n) => [n.id, n.title]));
    return raw.map((chunk) => ({
      ...chunk,
      document_title: title_by_id.get(chunk.document_id) ?? '(untitled)'
    }));
  }

  private static isSourceKeyedInput(input: NoteCreateInput): input is NoteCreateInput & { source: NoteSource; external_id: string } {
    return !!input.source && input.source !== NoteSource.Native && !!input.external_id;
  }

  private async upsertSourceKeyed(
    input: NoteCreateInput & { source: NoteSource; external_id: string }
  ): Promise<Note> {
    const existing = await this.notes_repo.getNoteByKey({
      user_id: input.user_id,
      source: input.source,
      external_id: input.external_id
    });
    const now = new Date();

    if (existing) {
      const patch: NotePatch = {
        title: input.title ?? existing.title,
        body: input.body ?? existing.body,
        body_raw: input.body_raw ?? existing.body_raw,
        tags: input.tags ?? existing.tags,
        container: input.container ?? existing.container,
        folder_id: input.folder_id ?? existing.folder_id,

        provider_created_at: input.provider_created_at ?? existing.provider_created_at,
        provider_updated_at: input.provider_updated_at ?? now,

        is_archived: input.is_archived ?? existing.is_archived,
        is_pinned: input.is_pinned ?? existing.is_pinned,
        is_deleted: input.is_deleted ?? existing.is_deleted,

        metadata: input.metadata ?? existing.metadata,
        vectorization: input.vectorization ?? existing.vectorization
      };

      const updated = await this.notes_repo.updateNoteByKey({
        user_id: input.user_id,
        source: input.source,
        external_id: input.external_id,
        patch
      });
      return updated ?? existing;
    }

    const note: Note = {
      id: Id.generateUuidV7(),
      user_id: input.user_id,
      source: input.source,
      external_id: input.external_id,

      title: input.title,
      body: input.body,
      body_raw: input.body_raw,

      tags: input.tags ?? [],
      container: input.container,
      folder_id: input.folder_id,

      provider_created_at: input.provider_created_at,
      provider_updated_at: input.provider_updated_at,
      last_synced_at: undefined,
      sync_status: SyncStatus.Idle,

      is_archived: input.is_archived ?? false,
      is_pinned: input.is_pinned ?? false,
      is_deleted: input.is_deleted ?? false,

      metadata: input.metadata,
      vectorization: input.vectorization,

      created_at: now,
      updated_at: now
    };

    return this.notes_repo.createNote(note);
  }

  private async createNative(input: NoteCreateInput): Promise<Note> {
    const now = new Date();
    const note: Note = {
      id: Id.generateUuidV7(),
      user_id: input.user_id,
      source: NoteSource.Native,
      external_id: undefined,

      title: input.title,
      body: input.body,
      body_raw: input.body_raw,

      tags: input.tags ?? [],
      container: input.container,
      folder_id: input.folder_id,

      provider_created_at: undefined,
      provider_updated_at: undefined,
      last_synced_at: undefined,
      sync_status: SyncStatus.Idle,

      is_archived: input.is_archived ?? false,
      is_pinned: input.is_pinned ?? false,
      is_deleted: input.is_deleted ?? false,

      metadata: input.metadata,
      vectorization: input.vectorization,

      created_at: now,
      updated_at: now
    };

    return this.notes_repo.createNote(note);
  }
}
