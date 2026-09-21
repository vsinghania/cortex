/*
 * The sync pass, with Graph and the note store in memory. NoteFoldersSvc is the real
 * thing over an in-memory repository, so the folder tree these assertions describe is
 * the one production would build.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OneNoteSyncSvc } from '../src/onenote_svc/onenote_sync_svc.js';
import { NoteFoldersSvc } from '../src/notes_svc/note_folders_svc.js';
import { NoteFolderNameTakenError } from '../src/notes_svc/note_folder_errors.js';
import { NoteSource, SyncStatus } from '../src/notes_svc/types/note.types.js';
import type { Note } from '../src/notes_svc/types/note.types.js';
import type { NoteFolder } from '../src/notes_svc/types/note_folder.types.js';
import type { NoteFolderRepository } from '../src/notes_svc/repositories/note_folder_repository_interface.js';
import type { NotesSvc } from '../src/notes_svc/notes_svc.js';
import type { OneNoteConnectionSvc } from '../src/onenote_svc/onenote_connection_svc.js';
import type { GraphPage, GraphSection } from '../src/onenote_svc/types/graph.types.js';
import type { OneNoteConnection } from '../src/onenote_svc/types/onenote_connection.types.js';
import { BadRequestError } from '../src/common/errors.js';
import {
  GraphForbiddenError,
  GraphRequestFailedError,
  OneNoteReauthRequiredError
} from '../src/onenote_svc/onenote_errors.js';

const USER_ID = 'user-1';

// --- fakes -----------------------------------------------------------------

class InMemoryFolderRepo implements NoteFolderRepository {
  constructor(readonly folders: NoteFolder[] = []) {}
  async createFolder(folder: NoteFolder) {
    const clash = await this.findChildByName({ user_id: folder.user_id, parent_id: folder.parent_id, name: folder.name });
    if (clash) throw new NoteFolderNameTakenError(folder.name);
    this.folders.push(folder);
    return folder;
  }
  async getFolder(p: { user_id: string; id: string }) {
    return this.folders.find((f) => f.user_id === p.user_id && f.id === p.id) ?? null;
  }
  async findChildByName(p: { user_id: string; parent_id: string | null; name: string }) {
    return (
      this.folders.find(
        (f) => f.user_id === p.user_id && f.parent_id === p.parent_id && f.name.toLowerCase() === p.name.toLowerCase()
      ) ?? null
    );
  }
  async findByProviderKey(p: { user_id: string; source: NoteSource; external_id: string }) {
    return this.folders.find((f) => f.user_id === p.user_id && f.source === p.source && f.external_id === p.external_id) ?? null;
  }
  async listFolders(p: { user_id: string }) {
    return this.folders.filter((f) => f.user_id === p.user_id);
  }
  async listDescendants(p: { user_id: string; id: string }) {
    return this.folders.filter((f) => f.ancestor_ids.includes(p.id));
  }
  async renameFolder(p: { user_id: string; id: string; name: string }) {
    const f = await this.getFolder(p);
    if (f) f.name = p.name;
    return f;
  }
  async moveFolder(p: { folder: NoteFolder; placement: { parent_id: string | null; ancestor_ids: string[] } }) {
    const f = await this.getFolder({ user_id: p.folder.user_id, id: p.folder.id });
    if (f) Object.assign(f, p.placement);
    return f;
  }
  async deleteFolders() {
    return 0;
  }
}

class FakeNotes {
  readonly notes: Note[] = [];
  created = 0;
  patches: Array<Record<string, unknown>> = [];

  async getNote(user_id: string, locator: { source?: NoteSource; external_id?: string; id?: string }) {
    return this.notes.find((n) => n.user_id === user_id && n.external_id === locator.external_id) ?? null;
  }

  async createNote(input: any) {
    this.created += 1;
    const existing = await this.getNote(input.user_id, input);
    const note = { ...(existing ?? {}), ...input, id: existing?.id ?? `note-${this.notes.length + 1}` } as Note;
    if (existing) this.notes.splice(this.notes.indexOf(existing), 1, note);
    else this.notes.push(note);
    return note;
  }

  async updateNote(user_id: string, locator: any, patch: Record<string, unknown>) {
    this.patches.push(patch);
    const note = await this.getNote(user_id, locator);
    if (note) Object.assign(note, patch);
    return note;
  }
}

class FakeGraph {
  content_calls = 0;
  list_pages_calls: Array<{ section_id: string; modified_after?: Date; next_link?: string }> = [];

  constructor(
    private readonly sections: GraphSection[],
    private readonly pages: Record<string, GraphPage[]>,
    private readonly content: Record<string, string> = {},
    private readonly failing_pages = new Set<string>(),
    /** Thrown by listPages for that section, as Graph would for a locked one. */
    private readonly failing_sections: Record<string, Error> = {}
  ) {}

  async listNotebooks() {
    return [];
  }
  async listSections() {
    return this.sections;
  }
  async listPages(p: { section_id: string; modified_after?: Date; next_link?: string }) {
    this.list_pages_calls.push(p);
    const failure = this.failing_sections[p.section_id];
    if (failure) throw failure;
    return { pages: this.pages[p.section_id] ?? [] };
  }
  async getPageContent(p: { page_id: string }) {
    this.content_calls += 1;
    if (this.failing_pages.has(p.page_id)) throw new Error('page is unreadable');
    return this.content[p.page_id] ?? `<p>${p.page_id}</p>`;
  }
}

function section(id: string, name: string, notebook_id: string, notebook_name: string): GraphSection {
  return { id, display_name: name, notebook: { id: notebook_id, display_name: notebook_name }, section_group: null };
}

function page(id: string, title: string, modified_at = new Date('2026-09-01T00:00:00Z')): GraphPage {
  return { id, title, modified_at, created_at: modified_at, web_url: `https://onenote.test/${id}` };
}

function connection(overrides: Partial<OneNoteConnection> = {}): OneNoteConnection {
  return {
    id: 'conn-1',
    user_id: USER_ID,
    microsoft_home_account_id: 'home-1',
    microsoft_email: 'ada@example.com',
    token_cache_sealed: 'sealed',
    scopes: [],
    selected_notebook_ids: ['nb-1'],
    notebooks: [{ id: 'nb-1', display_name: 'Tech' }],
    status: 'connected',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  } as OneNoteConnection;
}

async function buildSvc(args: { graph: FakeGraph; conn?: OneNoteConnection; notes?: FakeNotes }) {
  const notes = args.notes ?? new FakeNotes();
  const folder_repo = new InMemoryFolderRepo();
  const folders_svc = await NoteFoldersSvc.create({ folder_repo, notes_svc: {} as NotesSvc });
  const stored = args.conn ?? connection();
  const completed: Array<{ last_synced_at: Date }> = [];
  const notebooks_synced: Array<{ notebook_id: string; sync_watermark?: Date }> = [];

  const connection_svc = {
    getStoredConnection: async () => stored,
    graphFor: () => args.graph,
    recordNotebookSynced: async (p: { notebook_id: string; sync_watermark?: Date }) => {
      notebooks_synced.push(p);
    },
    recordSyncCompleted: async (p: { last_synced_at: Date }) => {
      completed.push(p);
    }
  } as unknown as OneNoteConnectionSvc;

  const svc = await OneNoteSyncSvc.create({ connection_svc, notes_svc: notes as unknown as NotesSvc, folders_svc });
  return { svc, notes, folder_repo, completed, notebooks_synced, stored };
}

// --- tests -----------------------------------------------------------------

test('pages import as notes filed under OneNote / notebook / section', async () => {
  const graph = new FakeGraph([section('sec-1', 'Auth', 'nb-1', 'Tech')], { 'sec-1': [page('p1', 'Tokens')] });
  const { svc, notes, folder_repo } = await buildSvc({ graph });

  const result = await svc.run({ user_id: USER_ID, mode: 'full' });

  assert.equal(result.completed, true);
  assert.deepEqual(result.stats.created, 1);
  assert.equal(notes.notes.length, 1);

  const note = notes.notes[0];
  assert.equal(note.source, NoteSource.OneNote);
  assert.equal(note.external_id, 'p1');
  assert.equal(note.title, 'Tokens');
  assert.equal(note.metadata?.provider_url, 'https://onenote.test/p1');
  assert.equal(note.sync_status, SyncStatus.Ok);
  assert.ok(note.last_synced_at, 'stamped in the same write, not a second one');

  const names = folder_repo.folders.map((f) => f.name);
  assert.deepEqual(names, ['OneNote', 'Tech', 'Auth']);
  assert.equal(folder_repo.folders.find((f) => f.name === 'Auth')?.id, note.folder_id);
});

test('only sections from chosen notebooks are walked', async () => {
  const graph = new FakeGraph(
    [section('sec-1', 'Auth', 'nb-1', 'Tech'), section('sec-2', 'Recipes', 'nb-2', 'Personal')],
    { 'sec-1': [page('p1', 'Tokens')], 'sec-2': [page('p2', 'Soup')] }
  );
  const { svc, notes } = await buildSvc({ graph });

  await svc.run({ user_id: USER_ID, mode: 'full' });

  assert.deepEqual(notes.notes.map((n) => n.external_id), ['p1']);
  assert.deepEqual(graph.list_pages_calls.map((c) => c.section_id), ['sec-1']);
});

test('an unchanged page is not rewritten, only re-stamped', async () => {
  const graph = new FakeGraph([section('sec-1', 'Auth', 'nb-1', 'Tech')], { 'sec-1': [page('p1', 'Tokens')] });
  const first = await buildSvc({ graph });
  await first.svc.run({ user_id: USER_ID, mode: 'full' });
  const created_before = first.notes.created;

  const again = await buildSvc({ graph, notes: first.notes });
  const result = await again.svc.run({ user_id: USER_ID, mode: 'full' });

  assert.equal(result.stats.unchanged, 1);
  assert.equal(result.stats.created + result.stats.updated, 0);
  assert.equal(first.notes.created, created_before, 'no second write of the same body');
  assert.deepEqual(Object.keys(first.notes.patches[0]).sort(), ['last_synced_at', 'sync_status']);
});

test('a page whose content changed is written again', async () => {
  const content: Record<string, string> = { p1: '<p>before</p>' };
  const graph = new FakeGraph([section('sec-1', 'Auth', 'nb-1', 'Tech')], { 'sec-1': [page('p1', 'Tokens')] }, content);
  const first = await buildSvc({ graph });
  await first.svc.run({ user_id: USER_ID, mode: 'full' });

  content.p1 = '<p>after</p>';
  const again = await buildSvc({ graph, notes: first.notes });
  const result = await again.svc.run({ user_id: USER_ID, mode: 'full' });

  assert.equal(result.stats.updated, 1);
  assert.match(first.notes.notes[0].body, /after/);
  assert.equal(first.notes.notes.length, 1, 'the upsert key keeps it one note');
});

test('one unreadable page is recorded and the pass still completes', async () => {
  const graph = new FakeGraph(
    [section('sec-1', 'Auth', 'nb-1', 'Tech')],
    { 'sec-1': [page('p1', 'Good'), page('p2', 'Bad'), page('p3', 'Also good')] },
    {},
    new Set(['p2'])
  );
  const { svc, notes } = await buildSvc({ graph });
  const errors: Array<{ item_id: string }> = [];

  const result = await svc.run({ user_id: USER_ID, mode: 'full', onError: (e) => errors.push(e) });

  assert.equal(result.completed, true);
  assert.equal(result.stats.failed, 1);
  assert.equal(result.stats.created, 2);
  assert.deepEqual(errors.map((e) => e.item_id), ['p2']);
  assert.deepEqual(notes.notes.map((n) => n.external_id), ['p1', 'p3']);
});

test('a password-protected section is skipped, and the rest of the pass still runs', async () => {
  // Graph answers 403 / 20185 for an encrypted section. Reading that as a dead grant
  // stopped a real sync at the same page count every time.
  const graph = new FakeGraph(
    [
      section('sec-1', 'Notes', 'nb-1', 'Tech'),
      section('sec-2', 'Personal', 'nb-1', 'Tech'),
      section('sec-3', 'KB', 'nb-1', 'Tech')
    ],
    { 'sec-1': [page('p1', 'One')], 'sec-3': [page('p3', 'Three')] },
    {},
    new Set(),
    { 'sec-2': new GraphForbiddenError('Encrypted sections are not accessible.', '20185') }
  );
  const { svc, notes } = await buildSvc({ graph });
  const errors: Array<{ item_id: string; message: string }> = [];

  const result = await svc.run({ user_id: USER_ID, mode: 'full', onError: (e) => errors.push(e) });

  assert.equal(result.completed, true, 'one locked section must not end the pass');
  assert.equal(result.stats.sections_skipped, 1);
  assert.deepEqual(notes.notes.map((n) => n.external_id), ['p1', 'p3'], 'sections either side still import');
  assert.match(errors[0].message, /Personal: Encrypted/);
});

test('a section that has gone is skipped, but a dead grant still stops everything', async () => {
  const gone = new FakeGraph([section('sec-1', 'Gone', 'nb-1', 'Tech')], {}, {}, new Set(), {
    'sec-1': new GraphRequestFailedError('Graph request failed (404)', 404, '20001')
  });
  const { svc: tolerant } = await buildSvc({ graph: gone });
  const result = await tolerant.run({ user_id: USER_ID, mode: 'full' });

  assert.equal(result.completed, true);
  assert.equal(result.stats.sections_skipped, 1);

  const revoked = new FakeGraph([section('sec-1', 'Notes', 'nb-1', 'Tech')], {}, {}, new Set(), {
    'sec-1': new OneNoteReauthRequiredError()
  });
  const { svc: strict } = await buildSvc({ graph: revoked });
  await assert.rejects(strict.run({ user_id: USER_ID, mode: 'full' }), OneNoteReauthRequiredError);
});

test("each notebook's watermark moves only when that notebook is read to the end", async () => {
  const newest = new Date('2026-09-10T12:00:00Z');
  const graph = new FakeGraph([section('sec-1', 'Auth', 'nb-1', 'Tech')], {
    'sec-1': [page('p1', 'Old', new Date('2026-09-01T00:00:00Z')), page('p2', 'New', newest)]
  });
  const { svc, notebooks_synced } = await buildSvc({ graph });

  await svc.run({ user_id: USER_ID, mode: 'full' });

  assert.equal(notebooks_synced.length, 1);
  assert.equal(notebooks_synced[0].notebook_id, 'nb-1');
  assert.equal(notebooks_synced[0].sync_watermark?.toISOString(), newest.toISOString());
});

test('a scoped pass leaves the other notebooks\' watermarks untouched', async () => {
  const conn = connection({
    selected_notebook_ids: ['nb-1', 'nb-2'],
    notebooks: [
      { id: 'nb-1', display_name: 'Tech' },
      { id: 'nb-2', display_name: 'Personal' }
    ]
  });
  const graph = new FakeGraph(
    [section('sec-1', 'Auth', 'nb-1', 'Tech'), section('sec-2', 'Recipes', 'nb-2', 'Personal')],
    { 'sec-1': [page('p1', 'Tokens')], 'sec-2': [page('p2', 'Soup')] }
  );
  const { svc, notebooks_synced, notes } = await buildSvc({ graph, conn });

  await svc.run({ user_id: USER_ID, mode: 'full', notebook_ids: ['nb-2'] });

  assert.deepEqual(notebooks_synced.map((n) => n.notebook_id), ['nb-2'], 'only the scoped notebook advances');
  assert.deepEqual(notes.notes.map((n) => n.external_id), ['p2']);
});

test('a scope naming a notebook that is not selected syncs nothing', async () => {
  const graph = new FakeGraph([section('sec-1', 'Auth', 'nb-1', 'Tech')], { 'sec-1': [page('p1', 'Tokens')] });
  const { svc, notes } = await buildSvc({ graph });

  const result = await svc.run({ user_id: USER_ID, mode: 'full', notebook_ids: ['nb-unselected'] });

  assert.equal(result.stats.notebooks, 0);
  assert.equal(notes.notes.length, 0);
});

test('an exhausted budget pauses with a checkpoint instead of finishing', async () => {
  const graph = new FakeGraph(
    [section('sec-1', 'A', 'nb-1', 'Tech'), section('sec-2', 'B', 'nb-1', 'Tech')],
    { 'sec-1': [page('p1', 'One')], 'sec-2': [page('p2', 'Two')] }
  );
  const { svc, notebooks_synced, notes } = await buildSvc({ graph });

  // Zero budget: the first section is finished, then the pass yields.
  const result = await svc.run({ user_id: USER_ID, mode: 'full', budget_ms: 0 });

  assert.equal(result.completed, false);
  assert.equal(result.checkpoint?.section_cursor, 'sec-1');
  assert.equal(notebooks_synced.length, 0, 'an unfinished notebook must not move its watermark');
  assert.deepEqual(notes.notes.map((n) => n.external_id), ['p1']);
});

test('resuming from a checkpoint continues after the section already drained', async () => {
  const graph = new FakeGraph(
    [section('sec-1', 'A', 'nb-1', 'Tech'), section('sec-2', 'B', 'nb-1', 'Tech')],
    { 'sec-1': [page('p1', 'One')], 'sec-2': [page('p2', 'Two')] }
  );
  const { svc, notes } = await buildSvc({ graph });

  const result = await svc.run({
    user_id: USER_ID,
    mode: 'full',
    checkpoint: { section_cursor: 'sec-1', pages_seen: 1 }
  });

  assert.equal(result.completed, true);
  assert.deepEqual(notes.notes.map((n) => n.external_id), ['p2'], 'sec-1 is not walked again');
  assert.equal(result.stats.pages_seen, 2, 'counters carry over so progress never goes backwards');
});

test('an incremental pass asks Graph for pages since the watermark, less an overlap', async () => {
  const watermark = new Date('2026-09-10T12:00:00Z');
  const graph = new FakeGraph([section('sec-1', 'Auth', 'nb-1', 'Tech')], { 'sec-1': [] });
  const { svc } = await buildSvc({
    graph,
    conn: connection({ notebooks: [{ id: 'nb-1', display_name: 'Tech', sync_watermark: watermark }] })
  });

  await svc.run({ user_id: USER_ID, mode: 'incremental' });

  const asked = graph.list_pages_calls[0].modified_after!;
  assert.equal(watermark.getTime() - asked.getTime(), 5 * 60 * 1000, 'five minutes of overlap');
});

test('a full pass ignores the watermark entirely', async () => {
  const graph = new FakeGraph([section('sec-1', 'Auth', 'nb-1', 'Tech')], { 'sec-1': [] });
  const { svc } = await buildSvc({
    graph,
    conn: connection({ notebooks: [{ id: 'nb-1', display_name: 'Tech', sync_watermark: new Date() }] })
  });

  await svc.run({ user_id: USER_ID, mode: 'full' });

  assert.equal(graph.list_pages_calls[0].modified_after, undefined);
});

test('syncing refuses until a notebook is chosen', async () => {
  const graph = new FakeGraph([], {});
  const { svc } = await buildSvc({ graph, conn: connection({ selected_notebook_ids: [] }) });

  await assert.rejects(svc.run({ user_id: USER_ID, mode: 'full' }), BadRequestError);
});

test('an abort stops the pass rather than being recorded as a failed page', async () => {
  const graph = new FakeGraph([section('sec-1', 'Auth', 'nb-1', 'Tech')], { 'sec-1': [page('p1', 'One')] });
  const { svc } = await buildSvc({ graph });
  const controller = new AbortController();
  controller.abort(new Error('worker draining'));

  await assert.rejects(svc.run({ user_id: USER_ID, mode: 'full', signal: controller.signal }), /draining/);
});

test('sections under a section group nest one level deeper', async () => {
  const grouped: GraphSection = {
    id: 'sec-1',
    display_name: 'Auth',
    notebook: { id: 'nb-1', display_name: 'Tech' },
    section_group: { id: 'grp-1', display_name: 'Backend' }
  };
  const graph = new FakeGraph([grouped], { 'sec-1': [page('p1', 'Tokens')] });
  const { svc, folder_repo } = await buildSvc({ graph });

  await svc.run({ user_id: USER_ID, mode: 'full' });

  assert.deepEqual(folder_repo.folders.map((f) => f.name), ['OneNote', 'Tech', 'Backend', 'Auth']);
  assert.deepEqual(
    folder_repo.folders.map((f) => f.container_type),
    [undefined, 'notebook', 'section_group', 'section']
  );
});
