/*
 * Backfills Note.edited_at on rows written before the field existed.
 *
 *   provider_updated_at ?? updated_at
 *
 * Without it, notes from before this change sort as if edited at the epoch — and reads
 * are `.lean()`, so the schema default never applies to them.
 *
 *   npm run notes:backfill-edited-at            # dry run, prints what it would do
 *   npm run notes:backfill-edited-at -- --apply
 */
import 'dotenv/config';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { DbNameResolver } from '../src/db/mongo/db_name_resolver.js';

const BATCH = 1000;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const db = DbNameResolver.resolve('notes');

  const mgr = await MongooseConnectionManager.getInstance({
    host: process.env.MONGO_HOST ?? 'localhost',
    port: Number(process.env.MONGO_PORT ?? 27017)
  });
  const conn = await mgr.getDbConnection({ db });
  const notes = conn.db!.collection('notes');

  const missing = await notes.countDocuments({ edited_at: { $exists: false } });
  console.log(`db ${db}: ${missing} note(s) without edited_at`);
  if (missing === 0 || !apply) {
    if (missing > 0) console.log('dry run — pass --apply to write');
    await mgr.disconnectAll();
    return;
  }

  let done = 0;
  for (;;) {
    const batch = await notes
      .find({ edited_at: { $exists: false } }, { projection: { _id: 1, provider_updated_at: 1, updated_at: 1 } })
      .limit(BATCH)
      .toArray();
    if (batch.length === 0) break;

    // One write per note: the value differs per row, so there is no single $set to apply.
    await notes.bulkWrite(
      batch.map((note) => ({
        updateOne: {
          filter: { _id: note._id },
          update: { $set: { edited_at: note.provider_updated_at ?? note.updated_at ?? new Date() } }
        }
      })),
      { ordered: false }
    );
    done += batch.length;
    console.log(`  ${done}/${missing}`);
  }

  console.log(`backfilled ${done} note(s)`);
  await mgr.disconnectAll();
}

void main()
  .catch((err) => {
    console.error(`backfill failed: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref());
