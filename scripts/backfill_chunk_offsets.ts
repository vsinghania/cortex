/* Backfills start_offset/end_offset on note_chunks written before offsets existed.
 *
 * Offsets are not part of the content hash, so re-running vectorizeNote reuses every
 * unchanged chunk (no embedding calls, no Qdrant writes) and only rewrites the Mongo
 * docs with the new range fields.
 *
 * Run:
 *   npm run notes:backfill-offsets
 *   npx tsx scripts/backfill_chunk_offsets.ts --dry-run
 */
import 'dotenv/config';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { MongooseNoteRepository } from '../src/notes_svc/repositories/mongoose_note_repository.js';
import { NotesVectorizationSvc } from '../src/notes_svc/notes_vectorization_svc.js';
import { DbNameResolver } from '../src/db/mongo/db_name_resolver.js';
import { Time } from '../src/lib/time.js';

type NoteRef = { note_id: string; user_id: string };

class BackfillChunkOffsets {
  static async main(): Promise<void> {
    const dry_run = process.argv.includes('--dry-run');
    const start_ms = performance.now();

    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = Number(process.env.MONGO_PORT ?? 27017);
    const mgr = await MongooseConnectionManager.getInstance({ host, port });
    const conn = await mgr.getDbConnection({
      db: DbNameResolver.resolve('notes'),
      host,
      port
    });

    // Raw collection access on purpose: compiling a second Note/NoteChunk model on this
    // connection would collide with the repositories' shared model factories.
    const rows = await conn
      .collection('note_chunks')
      .aggregate<NoteRef>([
        { $match: { start_offset: { $exists: false } } },
        { $group: { _id: { note_id: '$note_id', user_id: '$user_id' } } },
        { $project: { _id: 0, note_id: '$_id.note_id', user_id: '$_id.user_id' } }
      ])
      .toArray();

    console.log(`notes needing offsets: ${rows.length}${dry_run ? ' (dry run)' : ''}`);
    if (dry_run || rows.length === 0) {
      await BackfillChunkOffsets.shutdown(start_ms, 0, 0);
      return;
    }

    const notes_repo = await MongooseNoteRepository.create({ db: DbNameResolver.resolve('notes'), host, port });
    const svc = await NotesVectorizationSvc.create();
    let processed = 0;
    let failed = 0;

    for (const row of rows) {
      const note = await notes_repo.getNoteById({ user_id: row.user_id, id: row.note_id });
      if (!note) {
        console.warn(`  skip ${row.note_id}: note not found (orphan chunks)`);
        continue;
      }
      try {
        const result = await svc.vectorizeNote(note);
        processed += 1;
        console.log(`  ${row.note_id}: ${result.chunk_count} chunks`);
      } catch (err) {
        failed += 1;
        console.error(`  ${row.note_id}: failed`, err);
      }
    }

    await BackfillChunkOffsets.shutdown(start_ms, processed, failed);
  }

  private static async shutdown(start_ms: number, processed: number, failed: number): Promise<void> {
    console.log(
      `\ndone: notes_processed=${processed} failed=${failed} duration_ms=${Time.elapsedMs(start_ms)}`
    );
    await MongooseConnectionManager.getExistingInstance()?.disconnectAll();
    process.exit(failed > 0 ? 1 : 0);
  }
}

BackfillChunkOffsets.main().catch((err) => {
  console.error('backfill_chunk_offsets failed', err);
  process.exit(1);
});
