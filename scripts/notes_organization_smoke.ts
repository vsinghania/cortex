/* End-to-end smoke for notes organisation against real Mongo + Qdrant:
 *   folders (nesting, case-insensitive names, move, cycle guard, cascade delete),
 *   folder/pinned/archived list filters, sorting, organisational patches not bumping
 *   updated_at, bulk actions, tag deletion, archive exclusion from semantic search,
 *   pinned conversations, and (with --with-ai) a real filing suggestion.
 *
 * Uses a throwaway user id and cleans up after itself. Note bodies are left blank so no
 * embedding calls are made; Qdrant is exercised with a synthetic point instead.
 *
 * Run:
 *   npm run notes:smoke:organization
 *   npx tsx scripts/notes_organization_smoke.ts --with-ai
 */
import 'dotenv/config';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { NotesSvc } from '../src/notes_svc/notes_svc.js';
import { NoteFoldersSvc } from '../src/notes_svc/note_folders_svc.js';
import { NoteFolderNameTakenError } from '../src/notes_svc/note_folder_errors.js';
import { QdrantChunkVectorRepository } from '../src/notes_svc/repositories/qdrant_chunk_vector_repository.js';
import { ConversationStore } from '../src/agent_svc/conversation/conversation_store.js';
import { EmbeddingsSvc } from '../src/embeddings_svc/embeddings_svc.js';
import { NoteSource } from '../src/notes_svc/types/note.types.js';
import type { Note } from '../src/notes_svc/types/note.types.js';
import { DbNameResolver } from '../src/db/mongo/db_name_resolver.js';
import { Id } from '../src/lib/id.js';

class NotesOrganizationSmoke {
  private static readonly USER_ID = `smoke-org-${Id.generateUuidV7()}`;
  private static step = 0;

  static async main(): Promise<void> {
    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = Number(process.env.MONGO_PORT ?? 27017);
    await MongooseConnectionManager.getInstance({ host, port });
    const notes_svc = await NotesSvc.create({ host, port });
    const folders_svc = await NoteFoldersSvc.create({ host, port });

    try {
      await NotesOrganizationSmoke.checkFolders(folders_svc);
      await NotesOrganizationSmoke.checkFolderFilters(notes_svc, folders_svc);
      await NotesOrganizationSmoke.checkPinAndSort(notes_svc);
      await NotesOrganizationSmoke.checkArchive(notes_svc);
      await NotesOrganizationSmoke.checkTagDelete(notes_svc);
      await NotesOrganizationSmoke.checkBulk(notes_svc);
      await NotesOrganizationSmoke.checkFolderCascadeDelete(notes_svc, folders_svc);
      await NotesOrganizationSmoke.checkArchivedVectorSearch();
      await NotesOrganizationSmoke.checkPinnedConversation();
      if (process.argv.includes('--with-ai')) {
        await NotesOrganizationSmoke.checkFilingSuggestion(notes_svc, folders_svc);
      }
      console.log('\n✓ all notes organisation smoke checks passed for user', NotesOrganizationSmoke.USER_ID);
    } finally {
      await NotesOrganizationSmoke.cleanup(notes_svc, folders_svc);
      await MongooseConnectionManager.getExistingInstance()?.disconnectAll();
    }
    process.exit(0);
  }

  private static async checkFolders(folders_svc: NoteFoldersSvc): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const first = await folders_svc.ensurePath({ user_id, path: 'Work/Clients/Acme' });
    NotesOrganizationSmoke.assert(first.created_count === 3, 'ensurePath creates every missing segment');

    const again = await folders_svc.ensurePath({ user_id, path: 'work / CLIENTS/acme' });
    NotesOrganizationSmoke.assert(again.created_count === 0, 'ensurePath is idempotent and ignores case');
    NotesOrganizationSmoke.assert(again.folder.id === first.folder.id, 'ensurePath resolves the same leaf');
    NotesOrganizationSmoke.assert(again.path.join('/') === 'Work/Clients/Acme', 'ensurePath returns stored casing');

    await NotesOrganizationSmoke.assertRejects(
      () => folders_svc.createFolder({ user_id, name: 'WORK' }),
      NoteFolderNameTakenError,
      'sibling names are unique ignoring case'
    );

    const tree = await folders_svc.listTree({ user_id });
    const work = tree.find((f) => f.path.join('/') === 'Work')!;
    const clients = tree.find((f) => f.path.join('/') === 'Work/Clients')!;
    const acme = tree.find((f) => f.path.join('/') === 'Work/Clients/Acme')!;

    await NotesOrganizationSmoke.assertRejects(
      () => folders_svc.updateFolder({ user_id, folder_id: work.id, parent_id: acme.id }),
      Error,
      'a folder cannot move into its own subtree'
    );

    await folders_svc.updateFolder({ user_id, folder_id: clients.id, parent_id: null, name: 'Clients Top' });
    const moved_tree = await folders_svc.listTree({ user_id });
    const moved_acme = moved_tree.find((f) => f.id === acme.id)!;
    NotesOrganizationSmoke.assert(
      moved_acme.path.join('/') === 'Clients Top/Acme' && moved_acme.ancestor_ids.join() === clients.id,
      'moving a folder rewrites its descendants\' ancestor chain'
    );

    await folders_svc.updateFolder({ user_id, folder_id: clients.id, parent_id: work.id, name: 'Clients' });
    NotesOrganizationSmoke.pass('folders: nested create, case-insensitive names, move, cycle guard');
  }

  private static async checkFolderFilters(notes_svc: NotesSvc, folders_svc: NoteFoldersSvc): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const tree = await folders_svc.listTree({ user_id });
    const work = tree.find((f) => f.path.join('/') === 'Work')!;
    const acme = tree.find((f) => f.path.join('/') === 'Work/Clients/Acme')!;

    const in_work = await NotesOrganizationSmoke.createNote(notes_svc, 'In work', { folder_id: work.id });
    const in_acme = await NotesOrganizationSmoke.createNote(notes_svc, 'In acme', { folder_id: acme.id });
    const unfiled = await NotesOrganizationSmoke.createNote(notes_svc, 'Unfiled');

    const direct = await notes_svc.listNotes({ user_id, filter: { folder: { folder_id: work.id } } });
    NotesOrganizationSmoke.assertIds(direct.items, [in_work.id], 'folder filter lists direct notes only');

    const subtree = await notes_svc.listNotes({ user_id, filter: { folder: { folder_id: work.id, include_subfolders: true } } });
    NotesOrganizationSmoke.assertIds(subtree.items, [in_work.id, in_acme.id], 'include_subfolders spans the subtree');

    const none = await notes_svc.listNotes({ user_id, filter: { folder: { folder_id: null } } });
    NotesOrganizationSmoke.assertIds(none.items, [unfiled.id], 'unfiled filter lists notes outside folders');

    const counts = await folders_svc.listTree({ user_id });
    NotesOrganizationSmoke.assert(counts.find((f) => f.id === acme.id)!.note_count === 1, 'folder tree carries note counts');

    const refiled = await notes_svc.updateNote(user_id, { id: in_acme.id }, { folder_id: null });
    NotesOrganizationSmoke.assert(refiled!.folder_id === undefined, 'folder_id null unfiles a note');

    await NotesOrganizationSmoke.assertRejects(
      () => notes_svc.updateNote(user_id, { id: unfiled.id }, { folder_id: 'not-a-folder' }),
      Error,
      'filing into an unknown folder is rejected'
    );

    await notes_svc.deleteNotes({ user_id, ids: [in_work.id, in_acme.id, unfiled.id] });
    NotesOrganizationSmoke.pass('folder list filters, counts and refiling');
  }

  private static async checkPinAndSort(notes_svc: NotesSvc): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const banana = await NotesOrganizationSmoke.createNote(notes_svc, 'Banana');
    const apple = await NotesOrganizationSmoke.createNote(notes_svc, 'apple');
    const cherry = await NotesOrganizationSmoke.createNote(notes_svc, 'cherry');

    const by_title = await notes_svc.listNotes({ user_id, sort: { field: 'title', order: 'asc' } });
    NotesOrganizationSmoke.assertOrder(by_title.items, [apple.id, banana.id, cherry.id], 'title sort ignores case');

    const by_title_desc = await notes_svc.listNotes({ user_id, sort: { field: 'title', order: 'desc' } });
    NotesOrganizationSmoke.assertOrder(by_title_desc.items, [cherry.id, banana.id, apple.id], 'title sort descends');

    const by_created = await notes_svc.listNotes({ user_id, sort: { field: 'created_at', order: 'asc' } });
    NotesOrganizationSmoke.assertOrder(by_created.items, [banana.id, apple.id, cherry.id], 'created_at sort ascends');

    await NotesOrganizationSmoke.pause();
    const pinned = await notes_svc.updateNote(user_id, { id: cherry.id }, { is_pinned: true });
    NotesOrganizationSmoke.assert(
      pinned!.updated_at.getTime() === cherry.updated_at.getTime(),
      'pinning does not bump updated_at'
    );

    const pinned_first = await notes_svc.listNotes({ user_id, sort: { field: 'title', order: 'asc' } });
    NotesOrganizationSmoke.assertOrder(pinned_first.items, [cherry.id, apple.id, banana.id], 'pinned notes lead the sort');

    const only_pinned = await notes_svc.listNotes({ user_id, filter: { pinned: true } });
    NotesOrganizationSmoke.assertIds(only_pinned.items, [cherry.id], 'pinned filter');

    await notes_svc.deleteNotes({ user_id, ids: [banana.id, apple.id, cherry.id] });
    NotesOrganizationSmoke.pass('sorting and pinning');
  }

  private static async checkArchive(notes_svc: NotesSvc): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const kept = await NotesOrganizationSmoke.createNote(notes_svc, 'Zebra kept');
    const archived = await NotesOrganizationSmoke.createNote(notes_svc, 'Zebra archived');
    await notes_svc.updateNote(user_id, { id: archived.id }, { is_archived: true });

    const listed = await notes_svc.listNotes({ user_id });
    NotesOrganizationSmoke.assertIds(listed.items, [kept.id], 'archived notes are hidden by default');

    const only = await notes_svc.listNotes({ user_id, filter: { archived: 'only' } });
    NotesOrganizationSmoke.assertIds(only.items, [archived.id], 'archived=only lists archived notes');

    const all = await notes_svc.listNotes({ user_id, filter: { archived: 'include' } });
    NotesOrganizationSmoke.assertIds(all.items, [kept.id, archived.id], 'archived=include lists both');

    const searched = await notes_svc.searchNotes({ user_id, query: 'zebra' });
    NotesOrganizationSmoke.assertIds(searched.items, [kept.id], 'text search excludes archived notes');

    const searched_all = await notes_svc.searchNotes({ user_id, query: 'zebra', archived: 'include' });
    NotesOrganizationSmoke.assertIds(searched_all.items, [kept.id, archived.id], 'text search can include archived');

    await notes_svc.deleteNotes({ user_id, ids: [kept.id, archived.id] });
    NotesOrganizationSmoke.pass('archive filters in list and text search');
  }

  private static async checkTagDelete(notes_svc: NotesSvc): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const upper = await NotesOrganizationSmoke.createNote(notes_svc, 'Upper', { tags: ['Work', 'keep'] });
    const lower = await NotesOrganizationSmoke.createNote(notes_svc, 'Lower', { tags: ['work'] });
    const other = await NotesOrganizationSmoke.createNote(notes_svc, 'Other', { tags: ['keep'] });

    await NotesOrganizationSmoke.pause();
    const notes_updated = await notes_svc.deleteTag({ user_id, tag: 'WORK' });
    NotesOrganizationSmoke.assert(notes_updated === 2, `tag delete updates both casings, got ${notes_updated}`);

    const [upper_after, lower_after, other_after] = await Promise.all(
      [upper, lower, other].map((n) => notes_svc.getNote(user_id, { id: n.id }))
    );
    NotesOrganizationSmoke.assert(upper_after!.tags.join() === 'keep', 'other tags survive');
    NotesOrganizationSmoke.assert(lower_after!.tags.length === 0, 'lowercase variant removed');
    NotesOrganizationSmoke.assert(other_after!.tags.join() === 'keep', 'untagged notes untouched');
    NotesOrganizationSmoke.assert(
      upper_after!.updated_at.getTime() === upper.updated_at.getTime(),
      'tag delete does not bump updated_at'
    );

    const facet = await notes_svc.listTags({ user_id });
    NotesOrganizationSmoke.assert(!facet.some((t) => t.tag.toLowerCase() === 'work'), 'tag facet no longer lists it');
    NotesOrganizationSmoke.assert((await notes_svc.deleteTag({ user_id, tag: 'work' })) === 0, 'deleting a missing tag changes nothing');

    await notes_svc.deleteNotes({ user_id, ids: [upper.id, lower.id, other.id] });
    NotesOrganizationSmoke.pass('tag deletion across notes');
  }

  private static async checkBulk(notes_svc: NotesSvc): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const a = await NotesOrganizationSmoke.createNote(notes_svc, 'Bulk A');
    const b = await NotesOrganizationSmoke.createNote(notes_svc, 'Bulk B', { tags: ['old'] });
    const ids = [a.id, b.id];

    const pin = await notes_svc.bulkUpdate({ user_id, ids, action: { action: 'pin' } });
    NotesOrganizationSmoke.assert(pin.matched === 2 && pin.modified === 2, 'bulk pin matches and modifies both');

    await notes_svc.bulkUpdate({ user_id, ids, action: { action: 'add_tags', tags: ['new', 'new'] } });
    await notes_svc.bulkUpdate({ user_id, ids, action: { action: 'remove_tags', tags: ['OLD'] } });
    const tagged = await notes_svc.getNotesByIds({ user_id, ids });
    NotesOrganizationSmoke.assert(
      tagged.every((n) => n.is_pinned && n.tags.join() === 'new'),
      'bulk tag add dedupes and remove ignores case'
    );

    const foreign = await notes_svc.bulkUpdate({ user_id: `${user_id}-other`, ids, action: { action: 'archive' } });
    NotesOrganizationSmoke.assert(foreign.matched === 0, 'bulk updates are scoped to the owner');

    const deleted = await notes_svc.bulkUpdate({ user_id, ids, action: { action: 'delete' } });
    NotesOrganizationSmoke.assert(deleted.modified === 2, 'bulk delete removes both');
    NotesOrganizationSmoke.pass('bulk pin, tags, ownership scope, delete');
  }

  private static async checkFolderCascadeDelete(notes_svc: NotesSvc, folders_svc: NoteFoldersSvc): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const tree = await folders_svc.listTree({ user_id });
    const work = tree.find((f) => f.path.join('/') === 'Work')!;
    const acme = tree.find((f) => f.path.join('/') === 'Work/Clients/Acme')!;
    const keeper_folder = await folders_svc.createFolder({ user_id, name: 'Personal' });

    const doomed_top = await NotesOrganizationSmoke.createNote(notes_svc, 'Doomed top', { folder_id: work.id });
    const doomed_deep = await NotesOrganizationSmoke.createNote(notes_svc, 'Doomed deep', { folder_id: acme.id });
    const survivor = await NotesOrganizationSmoke.createNote(notes_svc, 'Survivor', { folder_id: keeper_folder.id });

    const result = await folders_svc.deleteFolder({ user_id, folder_id: work.id });
    NotesOrganizationSmoke.assert(result.folders_deleted === 3, `cascade deletes 3 folders, got ${result.folders_deleted}`);
    NotesOrganizationSmoke.assert(result.notes_deleted === 2, `cascade deletes 2 notes, got ${result.notes_deleted}`);

    const remaining = await notes_svc.getNotesByIds({ user_id, ids: [doomed_top.id, doomed_deep.id, survivor.id] });
    NotesOrganizationSmoke.assertIds(remaining, [survivor.id], 'only notes outside the subtree survive');

    const trashed = await NotesOrganizationSmoke.countInTrash([doomed_top.id, doomed_deep.id]);
    NotesOrganizationSmoke.assert(trashed === 2, `cascade-deleted notes are snapshotted to trash, got ${trashed}`);

    const tree_after = await folders_svc.listTree({ user_id });
    NotesOrganizationSmoke.assert(tree_after.map((f) => f.name).join() === 'Personal', 'only the unrelated folder remains');

    await folders_svc.deleteFolder({ user_id, folder_id: keeper_folder.id });
    NotesOrganizationSmoke.pass('cascading folder delete');
  }

  private static async checkArchivedVectorSearch(): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const vector_repo = QdrantChunkVectorRepository.create();
    const note_id = Id.generateUuidV7();
    const vector = Array.from({ length: EmbeddingsSvc.getInstance().dimensions }, (_, i) => (i === 0 ? 1 : 0));

    try {
      await vector_repo.upsertVectors([{ id: Id.generateUuidV7(), vector, user_id, note_id, source: NoteSource.Native, is_archived: false }]);
      const search = (include_archived: boolean) =>
        vector_repo.searchTopK({ user_id, query_vector: vector, k: 5, include_archived });

      NotesOrganizationSmoke.assert((await search(false)).length === 1, 'unarchived point is searchable');
      await vector_repo.setArchived({ user_id, note_ids: [note_id], is_archived: true });
      NotesOrganizationSmoke.assert((await search(false)).length === 0, 'archived point is excluded by default');
      NotesOrganizationSmoke.assert((await search(true)).length === 1, 'include_archived brings it back');
    } finally {
      await vector_repo.deleteByNoteIds({ user_id, note_ids: [note_id] });
    }
    NotesOrganizationSmoke.pass('semantic search archive exclusion (Qdrant)');
  }

  private static async checkPinnedConversation(): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const store = await ConversationStore.getInstance();
    const { conversation } = await store.ensureConversation({ user_id, agent_id: 'smoke-organization' });

    try {
      await NotesOrganizationSmoke.pause();
      const pinned = await store.setPinnedForUser({ conversation_id: conversation.conversation_id, user_id, is_pinned: true });
      NotesOrganizationSmoke.assert(pinned?.is_pinned === true, 'conversation pinned');
      NotesOrganizationSmoke.assert(
        pinned!.updated_at.getTime() === conversation.updated_at.getTime(),
        'pinning a conversation does not bump updated_at'
      );

      const foreign = await store.setPinnedForUser({ conversation_id: conversation.conversation_id, user_id: `${user_id}-other`, is_pinned: false });
      NotesOrganizationSmoke.assert(foreign === null, 'only the owner can pin a conversation');

      const pinned_list = await store.listForUser({ user_id, pinned: true });
      const unpinned_list = await store.listForUser({ user_id, pinned: false });
      NotesOrganizationSmoke.assert(pinned_list.length === 1 && unpinned_list.length === 0, 'pinned filter splits the list');
    } finally {
      await store.deleteForUser({ conversation_id: conversation.conversation_id, user_id });
    }
    NotesOrganizationSmoke.pass('pinned conversations');
  }

  private static async checkFilingSuggestion(notes_svc: NotesSvc, folders_svc: NoteFoldersSvc): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const recipes = await folders_svc.ensurePath({ user_id, path: 'Home/Recipes' });
    await folders_svc.ensurePath({ user_id, path: 'Work/Meetings' });
    const tagged = await NotesOrganizationSmoke.createNote(notes_svc, 'Pasta', { tags: ['Cooking'] });

    const suggestion = await notes_svc.suggestFiling({
      user_id,
      body: 'Slow-cooked tomato sauce: simmer garlic, olive oil and crushed tomatoes for two hours, finish with basil.'
    });
    console.log('    suggestion:', JSON.stringify(suggestion));
    NotesOrganizationSmoke.assert(suggestion.title !== null, 'a title is suggested for an untitled note');
    NotesOrganizationSmoke.assert(suggestion.folder?.id === recipes.folder.id, 'the recipes folder is suggested');

    const titled = await notes_svc.suggestFiling({ user_id, title: 'Sauce', body: 'tomato sauce recipe' });
    NotesOrganizationSmoke.assert(titled.title === null, 'no title is suggested when one exists');

    await notes_svc.deleteNotes({ user_id, ids: [tagged.id] });
    NotesOrganizationSmoke.pass('AI filing suggestion');
  }

  private static async cleanup(notes_svc: NotesSvc, folders_svc: NoteFoldersSvc): Promise<void> {
    const user_id = NotesOrganizationSmoke.USER_ID;
    const { items } = await notes_svc.listNotes({ user_id, filter: { archived: 'include' }, limit: 100 });
    await notes_svc.deleteNotes({ user_id, ids: items.map((n) => n.id) });
    const folders = await folders_svc.listTree({ user_id });
    for (const top of folders.filter((f) => f.parent_id === null)) {
      await folders_svc.deleteFolder({ user_id, folder_id: top.id });
    }
  }

  private static async countInTrash(note_ids: string[]): Promise<number> {
    const conn = await MongooseConnectionManager.getExistingInstance()!.getDbConnection({ db: DbNameResolver.resolve('notes') });
    return conn.collection('notes_trash').countDocuments({ user_id: NotesOrganizationSmoke.USER_ID, id: { $in: note_ids } });
  }

  private static async createNote(
    notes_svc: NotesSvc,
    title: string,
    extra?: { folder_id?: string; tags?: string[] }
  ): Promise<Note> {
    // Whitespace, not '': the schema requires a body, and the chunker skips blank ones, so no embedding call.
    const note = await notes_svc.createNote({ user_id: NotesOrganizationSmoke.USER_ID, title, body: ' ', ...extra });
    // Distinct created_at/updated_at values keep date-sort assertions deterministic.
    await NotesOrganizationSmoke.pause();
    return note;
  }

  private static pause(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 15));
  }

  private static pass(label: string): void {
    NotesOrganizationSmoke.step++;
    console.log(`  [${NotesOrganizationSmoke.step}] ${label}`);
  }

  private static assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`assertion failed: ${message}`);
  }

  private static assertIds(items: Note[], expected: string[], message: string): void {
    const actual = items.map((n) => n.id).sort();
    NotesOrganizationSmoke.assert(actual.join() === [...expected].sort().join(), `${message} (got ${actual.length} notes)`);
  }

  private static assertOrder(items: Note[], expected: string[], message: string): void {
    const actual = items.map((n) => n.title);
    const expected_titles = expected.map((id) => items.find((n) => n.id === id)?.title ?? id);
    NotesOrganizationSmoke.assert(
      items.map((n) => n.id).join() === expected.join(),
      `${message} (got ${actual.join(', ')}; expected ${expected_titles.join(', ')})`
    );
  }

  private static async assertRejects(fn: () => Promise<unknown>, type: new (...args: never[]) => Error, message: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      NotesOrganizationSmoke.assert(err instanceof type, `${message} (threw ${(err as Error)?.constructor?.name})`);
      return;
    }
    throw new Error(`assertion failed: ${message} (did not throw)`);
  }
}

NotesOrganizationSmoke.main().catch((err) => {
  console.error('notes_organization_smoke failed', err);
  process.exit(1);
});
