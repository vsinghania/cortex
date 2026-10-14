import type {
  NoteFolder,
  NoteFolderContainerType,
  NoteFolderDeleteResult,
  NoteFolderNode
} from './types/note_folder.types.js';
import type { NoteSource } from './types/note.types.js';
import type { NoteFolderRepository } from './repositories/note_folder_repository_interface.js';
import { MongooseNoteFolderRepository } from './repositories/mongoose_note_folder_repository.js';
import { NoteFolderNameTakenError } from './note_folder_errors.js';
import { NoteFolderTree } from './note_folder_tree.js';
import { NotesSvc } from './notes_svc.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { NotFoundError } from '../common/errors.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';
import { logger } from '../common/logger.js';

export type EnsureProviderFolderInput = {
  user_id: string;
  source: NoteSource;
  /** The provider's id for this container; the root of a provider's tree may use a sentinel. */
  external_id: string;
  /** Omitted for a provider's root folder, which mirrors no single container. */
  container_type?: NoteFolderContainerType;
  name: string;
  parent_id: string | null;
};

export type NoteFolderUpdateInput = {
  user_id: string;
  folder_id: string;
  name?: string;
  description?: string;
  /** `null` moves the folder to the top level; omit to leave it where it is. */
  parent_id?: string | null;
};

export class NoteFoldersSvc {

  private constructor(
    private readonly folder_repo: NoteFolderRepository,
    private readonly notes_svc: NotesSvc
  ) {}

  /** Deps are injectable so the folder rules can be tested without Mongo. */
  static async create(
    params?: { db?: string; host?: string; port?: number; folder_repo?: NoteFolderRepository; notes_svc?: NotesSvc }
  ): Promise<NoteFoldersSvc> {
    const db = params?.db ?? DbNameResolver.resolve('notes');
    const [folder_repo, notes_svc] = await Promise.all([
      params?.folder_repo ?? MongooseNoteFolderRepository.create({ db, host: params?.host, port: params?.port }),
      params?.notes_svc ?? NotesSvc.create({ db, host: params?.host, port: params?.port })
    ]);
    return new NoteFoldersSvc(folder_repo, notes_svc);
  }

  async listFolderTree(params: { user_id: string }): Promise<NoteFolderNode[]> {
    const [folders, counts] = await Promise.all([
      this.folder_repo.listFolders(params),
      this.notes_svc.countNotesByFolder(params)
    ]);
    return NoteFolderTree.buildNodes(folders, counts);
  }

  async createFolder(params: { user_id: string; name: string; description?: string; parent_id?: string | null }): Promise<NoteFolder> {
    const name = NoteFolderTree.normalizeName(params.name);
    const description = NoteFolderTree.normalizeDescription(params.description ?? '');
    const parent = params.parent_id ? await this.requireFolder(params.user_id, params.parent_id) : null;
    const folder = await this.insertFolder({ user_id: params.user_id, name, description, parent });
    logger.info({ folder_id: folder.id, depth: folder.ancestor_ids.length + 1 }, 'note folder created');
    return folder;
  }

  /**
   * Walks `Work/Clients`, creating any missing segment; idempotent. Returns the leaf and its
   * path as stored, which keeps existing folders' casing rather than the caller's.
   */
  async ensureFolderPath(params: { user_id: string; path: string; description?: string }): Promise<{ folder: NoteFolder; path: string[]; created_count: number }> {
    const segments = NoteFolderTree.parsePath(params.path);
    const description = NoteFolderTree.normalizeDescription(params.description ?? '');
    let parent: NoteFolder | null = null;
    const path: string[] = [];
    let created_count = 0;
    for (const name of segments) {
      const existing = await this.folder_repo.findChildByName({
        user_id: params.user_id,
        parent_id: parent?.id ?? null,
        name
      });
      if (existing) {
        parent = existing;
      } else {
        parent = await this.insertFolderOrFindConcurrentMatch({
          user_id: params.user_id, name, parent,
          description: path.length === segments.length - 1 ? description : ''
        });
        created_count++;
      }
      path.push(parent.name);
    }
    logger.info({ folder_id: parent!.id, depth: segments.length, created_count }, 'note folder path ensured');
    return { folder: parent!, path, created_count };
  }

  /**
   * The folder a provider container maps to, found by its provider id rather than its
   * name. That is what keeps a sync idempotent across renames on either side: renaming
   * in Cortex does not make the next sync build a second folder, and renaming on the
   * provider renames this one instead of orphaning it.
   */
  async ensureProviderFolder(params: EnsureProviderFolderInput): Promise<NoteFolder> {
    const name = NoteFolderTree.normalizeName(params.name);
    const existing = await this.folder_repo.findByProviderKey({
      user_id: params.user_id,
      source: params.source,
      external_id: params.external_id
    });

    if (existing) return this.reconcileProviderFolder(existing, { ...params, name });

    const parent = params.parent_id ? await this.requireFolder(params.user_id, params.parent_id) : null;
    return this.insertProviderFolder({ ...params, name, parent });
  }

  private async reconcileProviderFolder(
    folder: NoteFolder,
    params: EnsureProviderFolderInput & { name: string }
  ): Promise<NoteFolder> {
    let current = folder;
    if (current.name !== params.name) {
      current = (await this.folder_repo.updateFolderDetails({ user_id: params.user_id, id: current.id, name: params.name })) ?? current;
    }
    // A section moved to another notebook on the provider side moves here too.
    if ((params.parent_id ?? null) !== current.parent_id) {
      current = await this.moveFolder(current, params.parent_id ?? null);
    }
    return current;
  }

  private async insertProviderFolder(
    params: EnsureProviderFolderInput & { name: string; parent: NoteFolder | null }
  ): Promise<NoteFolder> {
    NoteFolderTree.assertCanCreateUnder(params.parent);
    const now = new Date();
    const base = {
      user_id: params.user_id,
      source: params.source,
      external_id: params.external_id,
      container_type: params.container_type,
      ...NoteFolderTree.placementUnder(params.parent),
      created_at: now,
      updated_at: now
    };

    try {
      return await this.folder_repo.createFolder({ ...base, id: Id.generateUuidV7(), name: params.name });
    } catch (err) {
      if (!(err instanceof NoteFolderNameTakenError)) throw err;
      // Something else already holds that name here - a folder the user made, or another
      // container that happens to share it. Disambiguate deterministically rather than
      // adopting a folder we do not own: the suffix is derived from the provider id, so
      // the next sync lands on the same name.
      const name = NoteFolderTree.normalizeName(`${params.name} (${params.external_id.slice(-6)})`);
      return this.folder_repo.createFolder({ ...base, id: Id.generateUuidV7(), name });
    }
  }

  async updateFolder(input: NoteFolderUpdateInput): Promise<NoteFolder> {
    let folder = await this.requireFolder(input.user_id, input.folder_id);
    const moved = input.parent_id !== undefined && input.parent_id !== folder.parent_id;
    const name = input.name !== undefined ? NoteFolderTree.normalizeName(input.name) : undefined;
    const description = input.description !== undefined ? NoteFolderTree.normalizeDescription(input.description) : undefined;

    if (name !== undefined || description !== undefined) {
      const updated = await this.folder_repo.updateFolderDetails({ user_id: input.user_id, id: folder.id, name, description });
      if (!updated) throw new NotFoundError('Folder not found');
      folder = updated;
    }
    if (moved) {
      folder = await this.moveFolder(folder, input.parent_id ?? null);
    }

    logger.info({ folder_id: folder.id, renamed: input.name !== undefined, description_updated: description !== undefined, moved }, 'note folder updated');
    return folder;
  }

  /**
   * Cascades: the folder, every subfolder, and every note filed anywhere beneath it.
   * Notes go first, so a failure part-way leaves the folder tree in place to retry against.
   */
  async deleteFolder(params: { user_id: string; folder_id: string }): Promise<NoteFolderDeleteResult> {
    const start_ms = performance.now();
    const folder = await this.requireFolder(params.user_id, params.folder_id);
    const descendants = await this.folder_repo.listDescendants({ user_id: params.user_id, id: folder.id });
    const folder_ids = [folder.id, ...descendants.map((d) => d.id)];

    const note_ids = await this.notes_svc.listNoteIdsInFolders({ user_id: params.user_id, folder_ids });
    const notes_deleted = await this.notes_svc.deleteNotes({ user_id: params.user_id, ids: note_ids });
    const folders_deleted = await this.folder_repo.deleteFolders({ user_id: params.user_id, ids: folder_ids });

    logger.info(
      { folder_id: folder.id, folders_deleted, notes_deleted, duration_ms: Time.elapsedMs(start_ms) },
      'note folder deleted'
    );
    return { folders_deleted, notes_deleted };
  }

  private async moveFolder(folder: NoteFolder, new_parent_id: string | null): Promise<NoteFolder> {
    const new_parent = new_parent_id ? await this.requireFolder(folder.user_id, new_parent_id) : null;
    const descendants = await this.folder_repo.listDescendants({ user_id: folder.user_id, id: folder.id });
    NoteFolderTree.assertCanMove({ folder, new_parent, descendants });
    const moved = await this.folder_repo.moveFolder({
      folder,
      placement: NoteFolderTree.placementUnder(new_parent)
    });
    if (!moved) throw new NotFoundError('Folder not found');
    return moved;
  }

  private async insertFolder(params: { user_id: string; name: string; description?: string; parent: NoteFolder | null }): Promise<NoteFolder> {
    NoteFolderTree.assertCanCreateUnder(params.parent);
    const now = new Date();
    return this.folder_repo.createFolder({
      id: Id.generateUuidV7(),
      user_id: params.user_id,
      name: params.name,
      description: params.description ?? '',
      ...NoteFolderTree.placementUnder(params.parent),
      created_at: now,
      updated_at: now
    });
  }

  /** Two concurrent ensurePath calls can race to create the same segment; the loser reuses the winner's. */
  private async insertFolderOrFindConcurrentMatch(params: { user_id: string; name: string; description?: string; parent: NoteFolder | null }): Promise<NoteFolder> {
    try {
      return await this.insertFolder(params);
    } catch (err) {
      if (!(err instanceof NoteFolderNameTakenError)) throw err;
      const winner = await this.folder_repo.findChildByName({
        user_id: params.user_id,
        parent_id: params.parent?.id ?? null,
        name: params.name
      });
      if (!winner) throw err;
      return winner;
    }
  }

  private async requireFolder(user_id: string, folder_id: string): Promise<NoteFolder> {
    const folder = await this.folder_repo.getFolder({ user_id, id: folder_id });
    if (!folder) throw new NotFoundError('Folder not found');
    return folder;
  }
}
