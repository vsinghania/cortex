import type { Note, NoteContainer, NoteMetadata, NoteVectorization } from './types/note.types.js';
import { NoteSource, SyncStatus, Visibility } from './types/note.types.js';
import type { NoteRepository, NoteListParams as RepoListParams, NoteListResult as RepoListResult } from './repositories/note_repository_interface.js';
import { MongooseNoteRepository } from './repositories/mongoose_note_repository.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';

export type NoteListParams = RepoListParams;
export type NoteListResult = RepoListResult;

export type NoteKey = {
  user_id: string;
  source: NoteSource;
  external_id: string;
};

export type NoteUpsertInput = NoteKey & {
  title: string;
  body_plain: string;
  body_markdown?: string;
  tags?: string[];
  container?: NoteContainer;

  created_at_provider?: Date;
  updated_at_provider?: Date;

  // Optional overrides
  visibility?: Visibility;
  is_archived?: boolean;
  is_deleted?: boolean;

  metadata?: NoteMetadata;
  vectorization?: NoteVectorization;
};

export type NotePatch = Partial<Omit<Note, 'user_id' | 'source' | 'external_id' | 'created_at' | 'updated_at'>>;

/**
 * NotesSvc - domain service for CRUD/search on notes using a repository.
 * Defaults:
 *  - sync_status: idle
 *  - visibility: private
 *  - tags: []
 *  - is_archived: false
 *  - is_deleted: false
 *  - created_at/updated_at: now
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

  async getNoteByKey(key: NoteKey): Promise<Note | null> {
    return this.notes_repo.getNoteByKey(key);
  }

  async upsertNote(input: NoteUpsertInput): Promise<Note> {
    const existing = await this.notes_repo.getNoteByKey(input);
    const now = new Date();

    if (existing) {
      const patch: NotePatch = {
        title: input.title ?? existing.title,
        body_plain: input.body_plain ?? existing.body_plain,
        body_markdown: input.body_markdown ?? existing.body_markdown,
        tags: input.tags ?? existing.tags,
        container: input.container ?? existing.container,

        created_at_provider: input.created_at_provider ?? existing.created_at_provider,
        updated_at_provider: input.updated_at_provider ?? now,

        visibility: input.visibility ?? existing.visibility,
        is_archived: input.is_archived ?? existing.is_archived,
        is_deleted: input.is_deleted ?? existing.is_deleted,

        metadata: input.metadata ?? existing.metadata,
        vectorization: input.vectorization ?? existing.vectorization
      };

      const updated = await this.notes_repo.updateNoteByKey({
        ...input,
        patch
      });
      // notes_repo returns null if not found; but we already checked
      return updated ?? existing;
    }

    const note: Note = {
      user_id: input.user_id,
      source: input.source,
      external_id: input.external_id,

      title: input.title,
      body_plain: input.body_plain,
      body_markdown: input.body_markdown,

      tags: input.tags ?? [],

      container: input.container,

      created_at_provider: input.created_at_provider,
      updated_at_provider: input.updated_at_provider,
      last_synced_at: undefined,

      sync_status: SyncStatus.Idle,

      is_archived: input.is_archived ?? false,
      is_deleted: input.is_deleted ?? false,
      visibility: input.visibility ?? Visibility.Private,

      metadata: input.metadata,
      vectorization: input.vectorization,

      created_at: now,
      updated_at: now
    };

    return this.notes_repo.createNote(note);
  }

  async updateNoteByKey(params: NoteKey & { patch: NotePatch }): Promise<Note | null> {
    return this.notes_repo.updateNoteByKey(params);
  }

  async deleteNoteByKey(key: NoteKey): Promise<boolean> {
    return this.notes_repo.deleteNoteByKey(key);
  }

  async searchNotes(params: { user_id: string; query: string; limit?: number; offset?: number }): Promise<NoteListResult> {
    return this.notes_repo.searchNotes(params);
  }
}
