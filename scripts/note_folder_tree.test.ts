import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteFolderTree } from '../src/notes_svc/note_folder_tree.js';
import type { NoteFolder } from '../src/notes_svc/types/note_folder.types.js';

class FolderFixture {
  static make(id: string, name: string, ancestor_ids: string[] = []): NoteFolder {
    const now = new Date(0);
    return {
      id,
      user_id: 'u1',
      name,
      parent_id: ancestor_ids.at(-1) ?? null,
      ancestor_ids,
      created_at: now,
      updated_at: now
    };
  }

  /** A chain root > c1 > c2 > ... of the given length. */
  static chain(length: number): NoteFolder[] {
    const folders: NoteFolder[] = [];
    for (let i = 0; i < length; i++) {
      folders.push(FolderFixture.make(`f${i}`, `F${i}`, folders.map((f) => f.id)));
    }
    return folders;
  }
}

test('normalizeName trims and collapses whitespace', () => {
  assert.equal(NoteFolderTree.normalizeName('  Work   Stuff '), 'Work Stuff');
});

test('normalizeName rejects empty names, slashes and overlong names', () => {
  assert.throws(() => NoteFolderTree.normalizeName('   '), /empty/);
  assert.throws(() => NoteFolderTree.normalizeName('a/b'), /must not contain/);
  assert.throws(() => NoteFolderTree.normalizeName('x'.repeat(NoteFolderTree.MAX_NAME_CHARS + 1)), /at most/);
});

test('parsePath splits on slashes and ignores empty segments', () => {
  assert.deepEqual(NoteFolderTree.parsePath('/Work / Clients//'), ['Work', 'Clients']);
});

test('parsePath rejects an empty path and one deeper than the limit', () => {
  assert.throws(() => NoteFolderTree.parsePath(' / '), /at least one/);
  const too_deep = Array.from({ length: NoteFolderTree.MAX_DEPTH + 1 }, (_, i) => `f${i}`).join('/');
  assert.throws(() => NoteFolderTree.parsePath(too_deep), /levels deep/);
});

test('placementUnder a parent extends its ancestor chain', () => {
  const parent = FolderFixture.make('b', 'B', ['a']);
  assert.deepEqual(NoteFolderTree.placementUnder(parent), { parent_id: 'b', ancestor_ids: ['a', 'b'] });
  assert.deepEqual(NoteFolderTree.placementUnder(null), { parent_id: null, ancestor_ids: [] });
});

test('assertCanCreateUnder allows the deepest level and rejects one past it', () => {
  const chain = FolderFixture.chain(NoteFolderTree.MAX_DEPTH);
  assert.doesNotThrow(() => NoteFolderTree.assertCanCreateUnder(chain.at(-2)!));
  assert.throws(() => NoteFolderTree.assertCanCreateUnder(chain.at(-1)!), /levels deep/);
});

test('assertCanMove rejects moving a folder into itself or its subtree', () => {
  const [root, child, grandchild] = FolderFixture.chain(3);
  assert.throws(() => NoteFolderTree.assertCanMove({ folder: root, new_parent: root, descendants: [child, grandchild] }), /into itself/);
  assert.throws(() => NoteFolderTree.assertCanMove({ folder: root, new_parent: grandchild, descendants: [child, grandchild] }), /into itself/);
});

test('assertCanMove counts the whole moved subtree against the depth limit', () => {
  const target_chain = FolderFixture.chain(NoteFolderTree.MAX_DEPTH - 1);
  const target = target_chain.at(-1)!;
  const leaf = FolderFixture.make('x', 'X');
  const tall = FolderFixture.make('y', 'Y');
  const tall_child = FolderFixture.make('y1', 'Y1', ['y']);

  assert.doesNotThrow(() => NoteFolderTree.assertCanMove({ folder: leaf, new_parent: target, descendants: [] }));
  assert.throws(() => NoteFolderTree.assertCanMove({ folder: tall, new_parent: target, descendants: [tall_child] }), /levels deep/);
});

test('subtreeHeight counts levels relative to the folder', () => {
  const nested = FolderFixture.make('b', 'B', ['a']);
  const d1 = FolderFixture.make('c', 'C', ['a', 'b']);
  const d2 = FolderFixture.make('d', 'D', ['a', 'b', 'c']);
  assert.equal(NoteFolderTree.subtreeHeight(nested, []), 1);
  assert.equal(NoteFolderTree.subtreeHeight(nested, [d1, d2]), 3);
});

test('buildNodes attaches paths and counts, parents before children', () => {
  const work = FolderFixture.make('w', 'Work');
  const clients = FolderFixture.make('c', 'clients', ['w']);
  const archive = FolderFixture.make('a', 'Archive');
  const nodes = NoteFolderTree.buildNodes([clients, work, archive], [{ folder_id: 'c', count: 3 }]);

  assert.deepEqual(nodes.map((n) => n.path), [['Archive'], ['Work'], ['Work', 'clients']]);
  assert.equal(nodes.find((n) => n.id === 'c')!.note_count, 3);
  assert.equal(nodes.find((n) => n.id === 'w')!.note_count, 0);
});
