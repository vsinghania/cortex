/*
 * ensureProviderFolder: the rule that keeps a provider sync idempotent across renames on
 * either side. The folder repository is in memory; NoteFoldersSvc and NoteFolderTree are
 * the real code, including the sibling-name uniqueness that forces the collision path.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteFoldersSvc } from '../src/notes_svc/note_folders_svc.js';
import { NoteFolderNameTakenError } from '../src/notes_svc/note_folder_errors.js';
import { NoteSource } from '../src/notes_svc/types/note.types.js';
import type { NoteFolder } from '../src/notes_svc/types/note_folder.types.js';
import type {
  NoteFolderKey,
  NoteFolderPlacement,
  NoteFolderProviderKey,
  NoteFolderRepository
} from '../src/notes_svc/repositories/note_folder_repository_interface.js';
import type { NotesSvc } from '../src/notes_svc/notes_svc.js';

const USER_ID = 'user-1';

class InMemoryFolderRepo implements NoteFolderRepository {
  constructor(readonly folders: NoteFolder[] = []) {}

  async createFolder(folder: NoteFolder) {
    const clash = await this.findChildByName({
      user_id: folder.user_id,
      parent_id: folder.parent_id,
      name: folder.name
    });
    if (clash) throw new NoteFolderNameTakenError(folder.name);
    this.folders.push(folder);
    return folder;
  }

  async getFolder(params: NoteFolderKey) {
    return this.folders.find((f) => f.user_id === params.user_id && f.id === params.id) ?? null;
  }

  async findChildByName(params: { user_id: string; parent_id: string | null; name: string }) {
    return (
      this.folders.find(
        (f) =>
          f.user_id === params.user_id &&
          f.parent_id === params.parent_id &&
          f.name.toLowerCase() === params.name.toLowerCase()
      ) ?? null
    );
  }

  async findByProviderKey(params: NoteFolderProviderKey) {
    return (
      this.folders.find(
        (f) => f.user_id === params.user_id && f.source === params.source && f.external_id === params.external_id
      ) ?? null
    );
  }

  async listFolders(params: { user_id: string }) {
    return this.folders.filter((f) => f.user_id === params.user_id);
  }

  async listDescendants(params: NoteFolderKey) {
    return this.folders.filter((f) => f.user_id === params.user_id && f.ancestor_ids.includes(params.id));
  }

  async renameFolder(params: NoteFolderKey & { name: string }) {
    const folder = await this.getFolder(params);
    if (folder) folder.name = params.name;
    return folder;
  }

  async moveFolder(params: { folder: NoteFolder; placement: NoteFolderPlacement }) {
    const folder = await this.getFolder({ user_id: params.folder.user_id, id: params.folder.id });
    if (folder) Object.assign(folder, params.placement);
    return folder;
  }

  async deleteFolders(params: { user_id: string; ids: string[] }) {
    const before = this.folders.length;
    for (const id of params.ids) {
      const at = this.folders.findIndex((f) => f.user_id === params.user_id && f.id === id);
      if (at >= 0) this.folders.splice(at, 1);
    }
    return before - this.folders.length;
  }
}

async function svcWith(folder_repo: InMemoryFolderRepo) {
  return NoteFoldersSvc.create({ folder_repo, notes_svc: {} as NotesSvc });
}

function ensure(overrides: Partial<Parameters<NoteFoldersSvc['ensureProviderFolder']>[0]> = {}) {
  return {
    user_id: USER_ID,
    source: NoteSource.OneNote,
    external_id: 'section-abc123',
    container_type: 'section' as const,
    name: 'Tech',
    parent_id: null,
    ...overrides
  };
}

test('a provider folder is created once and found again by its provider id', async () => {
  const repo = new InMemoryFolderRepo();
  const svc = await svcWith(repo);

  const first = await svc.ensureProviderFolder(ensure());
  const second = await svc.ensureProviderFolder(ensure());

  assert.equal(repo.folders.length, 1, 're-syncing must not build a second folder');
  assert.equal(second.id, first.id);
  assert.equal(first.source, NoteSource.OneNote);
  assert.equal(first.container_type, 'section');
});

test('renaming on the provider side renames the folder in place', async () => {
  const repo = new InMemoryFolderRepo();
  const svc = await svcWith(repo);

  const before = await svc.ensureProviderFolder(ensure({ name: 'Tech' }));
  const after = await svc.ensureProviderFolder(ensure({ name: 'Engineering' }));

  assert.equal(after.id, before.id, 'the same folder, not an orphan plus a new one');
  assert.equal(after.name, 'Engineering');
  assert.equal(repo.folders.length, 1);
});

test('renaming the folder in Cortex does not make the next sync recreate it', async () => {
  const repo = new InMemoryFolderRepo();
  const svc = await svcWith(repo);
  const created = await svc.ensureProviderFolder(ensure({ name: 'Tech' }));

  // What a user rename looks like to the repository.
  repo.folders[0].name = 'My Tech Notes';
  const resynced = await svc.ensureProviderFolder(ensure({ name: 'Tech' }));

  assert.equal(repo.folders.length, 1, 'name matching would have created a duplicate here');
  assert.equal(resynced.id, created.id);
});

test('a container moved on the provider side moves the folder under its new parent', async () => {
  const repo = new InMemoryFolderRepo();
  const svc = await svcWith(repo);
  const a = await svc.ensureProviderFolder(ensure({ external_id: 'nb-a', name: 'Notebook A', container_type: 'notebook' }));
  const b = await svc.ensureProviderFolder(ensure({ external_id: 'nb-b', name: 'Notebook B', container_type: 'notebook' }));

  const section = await svc.ensureProviderFolder(ensure({ parent_id: a.id }));
  assert.equal(section.parent_id, a.id);

  const moved = await svc.ensureProviderFolder(ensure({ parent_id: b.id }));
  assert.equal(moved.id, section.id);
  assert.equal(moved.parent_id, b.id);
  assert.deepEqual(moved.ancestor_ids, [b.id]);
});

test('a name already taken by another folder is disambiguated, deterministically', async () => {
  const repo = new InMemoryFolderRepo();
  const svc = await svcWith(repo);

  // A folder the user made, which the sync does not own and must not adopt.
  const mine = await svc.ensureProviderFolder(ensure({ external_id: 'other-999999', name: 'Tech' }));
  const synced = await svc.ensureProviderFolder(ensure({ external_id: 'section-abc123', name: 'Tech' }));

  assert.notEqual(synced.id, mine.id);
  assert.equal(mine.name, 'Tech', 'the folder that was there first keeps its name');
  assert.equal(synced.name, 'Tech (abc123)');

  const again = await svc.ensureProviderFolder(ensure({ external_id: 'section-abc123', name: 'Tech' }));
  assert.equal(again.id, synced.id, 'the suffix is derived from the provider id, so it is stable');
  assert.equal(repo.folders.length, 2);
});

test('provider folders and hand-made folders coexist under one parent', async () => {
  const repo = new InMemoryFolderRepo();
  const svc = await svcWith(repo);

  const root = await svc.ensureProviderFolder(ensure({ external_id: 'root', name: 'OneNote', container_type: undefined }));
  await svc.ensureProviderFolder(ensure({ external_id: 'nb-a', name: 'Personal', container_type: 'notebook', parent_id: root.id }));
  const hand_made = await svc.createFolder({ user_id: USER_ID, name: 'Scratch', parent_id: root.id });

  assert.equal(hand_made.source, undefined, 'a folder the user made carries no provider identity');
  assert.equal(repo.folders.filter((f) => f.parent_id === root.id).length, 2);
});
