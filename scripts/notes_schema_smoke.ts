/* End-to-end smoke for the notes schema after the v1 reshape.
 *
 * Verifies the partial unique index behavior and the collapsed CRUD surface:
 *   1) Two native notes for the same user (no external_id) both persist.
 *   2) Two creates with the same (source, external_id) result in update, not duplicate.
 *   3) Update + delete via { id } locator works AND lands the note in notes_trash.
 *   4) Update + delete via { source, external_id } locator works AND lands the note in notes_trash.
 *
 * Idempotent: cleans up the user's notes on entry so reruns are deterministic.
 *
 * Run:
 *   npx tsx scripts/notes_schema_smoke.ts
 */
import 'dotenv/config';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { NotesSvc } from '../src/notes_svc/notes_svc.js';
import { NoteSource } from '../src/notes_svc/types/note.types.js';
import { NoteTrashModelFactory } from '../src/notes_svc/models/note_trash_model.js';
import { DbNameResolver } from '../src/db/mongo/db_name_resolver.js';
import { Id } from '../src/lib/id.js';
import type { TrashedNote } from '../src/notes_svc/types/note_trash.types.js';

class NotesSchemaSmoke {
  private static readonly USER_ID =
    process.env.SMOKE_NOTES_USER_ID ?? `smoke-${Id.generateUuidV7()}`;
  private static trash_model: any;

  static async main(): Promise<void> {
    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = Number(process.env.MONGO_PORT ?? 27017);
    const mgr = await MongooseConnectionManager.getInstance({ host, port });
    const conn = await mgr.getDbConnection({ db: DbNameResolver.resolve('notes'), host, port });
    NotesSchemaSmoke.trash_model = new NoteTrashModelFactory().getModel(conn);

    const notes_svc = await NotesSvc.create({ host, port });

    await NotesSchemaSmoke.cleanupForUser(notes_svc);

    await NotesSchemaSmoke.assertTwoNativeNotesPersist(notes_svc);
    await NotesSchemaSmoke.assertSourceKeyedUpsert(notes_svc);
    await NotesSchemaSmoke.assertUpdateAndDeleteByIdLocator(notes_svc);
    await NotesSchemaSmoke.assertUpdateAndDeleteBySourceKeyLocator(notes_svc);

    console.log('\n✓ all schema smoke checks passed for user', NotesSchemaSmoke.USER_ID);
    await MongooseConnectionManager.getExistingInstance()?.disconnectAll();
    process.exit(0);
  }

  private static async findInTrashById(id: string): Promise<TrashedNote | null> {
    const doc = await NotesSchemaSmoke.trash_model.findOne({ id }).lean();
    return doc ?? null;
  }

  private static async cleanupForUser(notes_svc: NotesSvc): Promise<void> {
    const { items } = await notes_svc.listNotes({ user_id: NotesSchemaSmoke.USER_ID, limit: 100 });
    for (const note of items) {
      await notes_svc.deleteNote(NotesSchemaSmoke.USER_ID, { id: note.id });
    }
  }

  private static async assertTwoNativeNotesPersist(notes_svc: NotesSvc): Promise<void> {
    const a = await notes_svc.createNote({
      user_id: NotesSchemaSmoke.USER_ID,
      title: 'Native A',
      body: 'first native note'
    });
    const b = await notes_svc.createNote({
      user_id: NotesSchemaSmoke.USER_ID,
      title: 'Native B',
      body: 'second native note'
    });

    NotesSchemaSmoke.assert(a.id !== b.id, 'native notes must have distinct ids');
    NotesSchemaSmoke.assert(a.source === NoteSource.Native, 'native source set on a');
    NotesSchemaSmoke.assert(b.source === NoteSource.Native, 'native source set on b');
    NotesSchemaSmoke.assert(a.external_id === undefined, 'no external_id on native a');
    NotesSchemaSmoke.assert(b.external_id === undefined, 'no external_id on native b');

    const { total } = await notes_svc.listNotes({ user_id: NotesSchemaSmoke.USER_ID });
    NotesSchemaSmoke.assert(total === 2, `expected 2 notes after native creates, got ${total}`);

    console.log('  [1/4] two native notes persist');
  }

  private static async assertSourceKeyedUpsert(notes_svc: NotesSvc): Promise<void> {
    const ext_id = 'onenote-page-001';
    const first = await notes_svc.createNote({
      user_id: NotesSchemaSmoke.USER_ID,
      source: NoteSource.OneNote,
      external_id: ext_id,
      title: 'OneNote v1',
      body: 'first version'
    });
    const second = await notes_svc.createNote({
      user_id: NotesSchemaSmoke.USER_ID,
      source: NoteSource.OneNote,
      external_id: ext_id,
      title: 'OneNote v2',
      body: 'updated version'
    });

    NotesSchemaSmoke.assert(first.id === second.id, 'second create must update, not insert (same id)');
    NotesSchemaSmoke.assert(second.title === 'OneNote v2', 'title updated on second create');

    console.log('  [2/4] source-keyed create-or-update is idempotent');
  }

  private static async assertUpdateAndDeleteByIdLocator(notes_svc: NotesSvc): Promise<void> {
    const created = await notes_svc.createNote({
      user_id: NotesSchemaSmoke.USER_ID,
      title: 'Locator-by-id',
      body: 'before'
    });

    const updated = await notes_svc.updateNote(
      NotesSchemaSmoke.USER_ID,
      { id: created.id },
      { body: 'after' }
    );
    NotesSchemaSmoke.assert(updated?.body === 'after', 'update by id locator applied');

    const deleted = await notes_svc.deleteNote(NotesSchemaSmoke.USER_ID, { id: created.id });
    NotesSchemaSmoke.assert(deleted, 'delete by id locator succeeded');

    const after = await notes_svc.getNote(NotesSchemaSmoke.USER_ID, { id: created.id });
    NotesSchemaSmoke.assert(after === null, 'note absent after delete by id');

    const trashed = await NotesSchemaSmoke.findInTrashById(created.id);
    NotesSchemaSmoke.assert(trashed !== null, 'note moved into notes_trash on delete');
    NotesSchemaSmoke.assert(
      trashed?.deleted_at instanceof Date,
      'trashed note has deleted_at timestamp'
    );

    console.log('  [3/4] update + delete via { id } locator (with trash backup)');
  }

  private static async assertUpdateAndDeleteBySourceKeyLocator(notes_svc: NotesSvc): Promise<void> {
    const ext_id = 'onenote-page-002';
    const created = await notes_svc.createNote({
      user_id: NotesSchemaSmoke.USER_ID,
      source: NoteSource.OneNote,
      external_id: ext_id,
      title: 'Locator-by-key',
      body: 'before'
    });

    const updated = await notes_svc.updateNote(
      NotesSchemaSmoke.USER_ID,
      { source: NoteSource.OneNote, external_id: ext_id },
      { body: 'after' }
    );
    NotesSchemaSmoke.assert(updated?.body === 'after', 'update by source-key locator applied');

    const deleted = await notes_svc.deleteNote(NotesSchemaSmoke.USER_ID, {
      source: NoteSource.OneNote,
      external_id: ext_id
    });
    NotesSchemaSmoke.assert(deleted, 'delete by source-key locator succeeded');

    const after = await notes_svc.getNote(NotesSchemaSmoke.USER_ID, {
      source: NoteSource.OneNote,
      external_id: ext_id
    });
    NotesSchemaSmoke.assert(after === null, 'note absent after delete by source key');

    const trashed = await NotesSchemaSmoke.findInTrashById(created.id);
    NotesSchemaSmoke.assert(trashed !== null, 'sourced note moved into notes_trash on delete');
    NotesSchemaSmoke.assert(
      trashed?.external_id === ext_id,
      'trashed sourced note preserved external_id'
    );

    console.log('  [4/4] update + delete via { source, external_id } locator (with trash backup)');
  }

  private static assert(condition: unknown, message: string): void {
    if (!condition) {
      throw new Error(`assertion failed: ${message}`);
    }
  }
}

NotesSchemaSmoke.main().catch((err) => {
  console.error('notes_schema_smoke failed', err);
  process.exit(1);
});
