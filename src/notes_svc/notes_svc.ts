import type { Note, NoteContainer, NoteLocator, NoteMetadata, NoteVectorization } from './types/note.types.js';
import { NoteSource, SyncStatus } from './types/note.types.js';
import type { NoteRepository, NoteListParams as RepoListParams, NoteListResult as RepoListResult } from './repositories/note_repository_interface.js';
import { MongooseNoteRepository } from './repositories/mongoose_note_repository.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { Id } from '../lib/id.js';

export type NoteListParams = RepoListParams;
export type NoteListResult = RepoListResult;

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
  is_deleted?: boolean;

  metadata?: NoteMetadata;
  vectorization?: NoteVectorization;
};

export type NotePatch = Partial<Omit<Note, 'id' | 'user_id' | 'source' | 'external_id' | 'created_at' | 'updated_at'>>;

/**
 * NotesSvc - domain service for CRUD/search on notes.
 *
 * One verb per operation; mutating ops accept a NoteLocator that is either
 * `{ id }` (works for any note) or `{ source, external_id }` (only valid for
 * source-keyed notes). Native notes have no external_id and must be located by id.
 */
export class NotesSvc {
  constructor(private readonly notes_repo: NoteRepository) {}

  static async create(params?: { db?: string; host?: string; port?: number }): Promise<NotesSvc> {
    const db = params?.db ?? DbNameResolver.resolve('notes');
    const notes_repo = await MongooseNoteRepository.create({ db, host: params?.host, port: params?.port });
    return new NotesSvc(notes_repo);
  }

  async listNotes(params: NoteListParams): Promise<NoteListResult> {
    return this.notes_repo.listNotes(params);
  }

  async getNote(user_id: string, locator: NoteLocator): Promise<Note | null> {
    if ('id' in locator) {
      return this.notes_repo.getNoteById({ user_id, id: locator.id });
    }
    return this.notes_repo.getNoteByKey({ user_id, source: locator.source, external_id: locator.external_id });
  }

  async createNote(input: NoteCreateInput): Promise<Note> {
    if (NotesSvc.isSourceKeyedInput(input)) {
      return this.upsertSourceKeyed(input);
    }
    return this.createNative(input);
  }

  async updateNote(user_id: string, locator: NoteLocator, patch: NotePatch): Promise<Note | null> {
    if ('id' in locator) {
      return this.notes_repo.updateNoteById({ user_id, id: locator.id, patch });
    }
    return this.notes_repo.updateNoteByKey({
      user_id,
      source: locator.source,
      external_id: locator.external_id,
      patch
    });
  }

  async deleteNote(user_id: string, locator: NoteLocator): Promise<boolean> {
    if ('id' in locator) {
      return this.notes_repo.deleteNoteById({ user_id, id: locator.id });
    }
    return this.notes_repo.deleteNoteByKey({
      user_id,
      source: locator.source,
      external_id: locator.external_id
    });
  }

  async searchNotes(params: { user_id: string; query: string; limit?: number; offset?: number }): Promise<NoteListResult> {
    return this.notes_repo.searchNotes(params);
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
      is_deleted: input.is_deleted ?? false,

      metadata: input.metadata,
      vectorization: input.vectorization,

      created_at: now,
      updated_at: now
    };

    return this.notes_repo.createNote(note);
  }
}
