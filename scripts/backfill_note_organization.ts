/* One-off backfill for the notes-organisation release. Run once per environment on deploy.
 *
 *   1) Sets `is_pinned: false` on notes written before pinning existed.
 *      Mongo sorts a missing field below `false`, so without this the pinned-first note sort
 *      splits old and new notes into separate blocks.
 *   2) Mirrors `is_archived: true` onto the Qdrant points of already-archived notes, so they
 *      drop out of semantic recall. Unarchived notes need nothing: a missing key means "not archived".
 *
 * Neither step touches `updated_at`. Safe to re-run.
 *
 * Run:
 *   npm run notes:backfill-organization
 *   npx tsx scripts/backfill_note_organization.ts --dry-run
 */
import 'dotenv/config';
import type { Connection } from 'mongoose';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { DbNameResolver } from '../src/db/mongo/db_name_resolver.js';
import { QdrantChunkVectorRepository } from '../src/notes_svc/repositories/qdrant_chunk_vector_repository.js';
import { Time } from '../src/lib/time.js';

type ArchivedNoteRef = { user_id: string; note_ids: string[] };

class BackfillNoteOrganization {
  static async main(): Promise<void> {
    const dry_run = process.argv.includes('--dry-run');
    const start_ms = performance.now();

    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = Number(process.env.MONGO_PORT ?? 27017);
    const mgr = await MongooseConnectionManager.getInstance({ host, port });
    const notes_conn = await mgr.getDbConnection({ db: DbNameResolver.resolve('notes'), host, port });

    // Raw collection access on purpose: compiling models here would collide with the
    // repositories' shared model factories on the same connection.
    const notes_pinned = await BackfillNoteOrganization.backfillPinned(notes_conn, 'notes', dry_run);
    const archived_notes = await BackfillNoteOrganization.syncArchivedVectors(notes_conn, dry_run);

    console.log(
      `\ndone${dry_run ? ' (dry run)' : ''}: notes_pinned_backfilled=${notes_pinned} ` +
      `archived_notes_synced=${archived_notes} ` +
      `duration_ms=${Time.elapsedMs(start_ms)}`
    );
    await MongooseConnectionManager.getExistingInstance()?.disconnectAll();
    process.exit(0);
  }

  private static async backfillPinned(conn: Connection, collection: string, dry_run: boolean): Promise<number> {
    const filter = { is_pinned: { $exists: false } };
    if (dry_run) return conn.collection(collection).countDocuments(filter);
    const result = await conn.collection(collection).updateMany(filter, { $set: { is_pinned: false } });
    return result.modifiedCount;
  }

  private static async syncArchivedVectors(conn: Connection, dry_run: boolean): Promise<number> {
    const groups = await conn
      .collection('notes')
      .aggregate<ArchivedNoteRef>([
        { $match: { is_archived: true } },
        { $group: { _id: '$user_id', note_ids: { $push: '$id' } } },
        { $project: { _id: 0, user_id: '$_id', note_ids: 1 } }
      ])
      .toArray();

    const total = groups.reduce((sum, g) => sum + g.note_ids.length, 0);
    if (dry_run || total === 0) return total;

    const vector_repo = QdrantChunkVectorRepository.create();
    for (const group of groups) {
      await vector_repo.setArchived({ user_id: group.user_id, note_ids: group.note_ids, is_archived: true });
    }
    return total;
  }
}

BackfillNoteOrganization.main().catch((err) => {
  console.error('backfill_note_organization failed', err);
  process.exit(1);
});
