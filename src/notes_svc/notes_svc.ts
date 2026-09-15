import type { Note, NoteContainer, NoteLocator, NoteMetadata, NoteVectorization } from './types/note.types.js';
import { NoteSource, SyncStatus } from './types/note.types.js';
import type {
  NoteRepository,
  NoteListParams as RepoListParams,
  NoteListResult as RepoListResult,
  NoteListFilter as RepoListFilter,
  NoteTagCount as RepoTagCount,
  NoteSearchParams,
  NotePatchFields
} from './repositories/note_repository_interface.js';
import type { NoteChunkRepository } from './repositories/note_chunk_repository_interface.js';
import type { NoteChunk } from './types/note_chunk.types.js';
import { MongooseNoteRepository } from './repositories/mongoose_note_repository.js';
import { MongooseNoteChunkRepository } from './repositories/mongoose_note_chunk_repository.js';
import { NotePatchKind } from './note_patch_kind.js';
import { NotesVectorizationSvc } from './notes_vectorization_svc.js';
import { RetrievalSvc } from '../retrieval_svc/retrieval_svc.js';
import type { RawRetrievedChunk, RetrievedChunk, RetrieveParams } from '../retrieval_svc/types/retrieval.types.js';
import { Corpus } from '../retrieval_svc/types/retrieval.types.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';
import { logger } from '../common/logger.js';

export type NoteListParams = RepoListParams;
export type NoteListResult = RepoListResult;
export type NoteListFilter = RepoListFilter;
export type NoteTagCount = RepoTagCount;

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

  provider_created_at?: Date;
  provider_updated_at?: Date;

  is_archived?: boolean;
  is_pinned?: boolean;
  is_deleted?: boolean;

  metadata?: NoteMetadata;
  vectorization?: NoteVectorization;
};

export type NotePatch = Omit<NotePatchFields, 'id' | 'user_id' | 'source' | 'external_id' | 'created_at' | 'updated_at'>;

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

  private constructor(private readonly notes_repo: NoteRepository) {}

  static async create(params?: { db?: string; host?: string; port?: number }): Promise<NotesSvc> {
    const db = params?.db ?? DbNameResolver.resolve('notes');
    const notes_repo = await MongooseNoteRepository.create({ db, host: params?.host, port: params?.port });
    return new NotesSvc(notes_repo);
  }

  async listNotes(params: NoteListParams): Promise<NoteListResult> {
    return this.notes_repo.listNotes(params);
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

  private async setArchivedSafely(params: { user_id: string; note_ids: string[]; is_archived: boolean }): Promise<void> {
    try {
      const svc = await this.vectorizationSvc();
      await svc.setArchived(params);
    } catch (err) {
      logger.warn({ err, note_count: params.note_ids.length }, 'note archive vector sync failed');
    }
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
