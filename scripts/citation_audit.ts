import 'dotenv/config';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { DbNameResolver } from '../src/db/mongo/db_name_resolver.js';

/**
 * Read-only audit of stored citations against live note chunks. Writes nothing.
 *
 * Answers two questions after a re-index sweep:
 *
 *  1. DANGLING - a cited chunk_id no longer exists. Happens when a note re-chunks
 *     into fewer chunks: surplus chunks are deleted. Degrades gracefully at read
 *     time (chunk_available: false), so this is a quality signal, not an outage.
 *
 *  2. REWRITTEN - a cited chunk was re-embedded during the sweep. This is the one
 *     that matters, because vectorizeNote reuses the existing chunk id at a given
 *     index (`id: draft.existing_id ?? ...`) even when the content changed. The
 *     citation still resolves, but may now deep-link into different text, with no
 *     error anywhere. Detected via vectorization.last_embedded_at: a chunk that was
 *     merely reused keeps its original timestamp; a re-embedded one is stamped now.
 *
 * Usage:
 *   npx tsx scripts/citation_audit.ts [--since 2026-09-09T00:00:00Z]
 */
class CitationAudit {
  private constructor() {}

  static parseSince(argv: string[]): Date | undefined {
    const i = argv.indexOf('--since');
    if (i === -1) return undefined;
    const parsed = new Date(argv[i + 1] ?? '');
    if (Number.isNaN(parsed.getTime())) throw new Error('--since needs an ISO timestamp');
    return parsed;
  }

  static async run(since?: Date): Promise<number> {
    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = Number(process.env.MONGO_PORT ?? 27017);
    const mgr = await MongooseConnectionManager.getInstance({ host, port });

    const agent_conn = await mgr.getDbConnection({ db: DbNameResolver.resolve('agent') });
    const notes_conn = await mgr.getDbConnection({ db: DbNameResolver.resolve('notes') });

    const messages = agent_conn.collection('conversation_messages');
    const chunks = notes_conn.collection('note_chunks');

    const cited = await messages
      .find({ citations: { $exists: true, $ne: null } }, { projection: { citations: 1, conversation_id: 1 } })
      .toArray();

    const by_chunk = new Map<string, number>();
    let total = 0;
    for (const msg of cited) {
      for (const c of (msg.citations as { chunk_id?: string }[]) ?? []) {
        if (!c?.chunk_id) continue;
        total++;
        by_chunk.set(c.chunk_id, (by_chunk.get(c.chunk_id) ?? 0) + 1);
      }
    }

    console.log(`\nmessages with citations : ${cited.length}`);
    console.log(`citations total         : ${total}`);
    console.log(`distinct chunks cited   : ${by_chunk.size}`);

    if (by_chunk.size === 0) {
      console.log('\nNothing to audit.\n');
      return 0;
    }

    const ids = [...by_chunk.keys()];
    const live = await chunks
      .find({ id: { $in: ids } }, { projection: { id: 1, note_id: 1, 'vectorization.last_embedded_at': 1 } })
      .toArray();
    const live_by_id = new Map(live.map((c) => [c.id as string, c]));

    const dangling = ids.filter((id) => !live_by_id.has(id));
    console.log(`\nDANGLING (chunk deleted): ${dangling.length}`);
    for (const id of dangling.slice(0, 10)) {
      console.log(`  ${id}  (cited ${by_chunk.get(id)}x)`);
    }
    if (dangling.length > 10) console.log(`  ... and ${dangling.length - 10} more`);

    if (!since) {
      console.log('\nPass --since <ISO> (the start of your re-index run) to also check for');
      console.log('rewritten chunks - cited ids whose content changed under them.\n');
      return dangling.length;
    }

    const rewritten = live.filter((c) => {
      const at = (c as any).vectorization?.last_embedded_at;
      return at && new Date(at) >= since;
    });

    console.log(`\nREWRITTEN since ${since.toISOString()}: ${rewritten.length}`);
    for (const c of rewritten.slice(0, 10)) {
      console.log(`  ${c.id}  note=${c.note_id}  (cited ${by_chunk.get(c.id as string)}x)`);
    }
    if (rewritten.length > 10) console.log(`  ... and ${rewritten.length - 10} more`);

    console.log(
      rewritten.length === 0
        ? '\nNo cited chunk was re-embedded: every citation still points at the text it cited.\n'
        : '\nThese citations resolve, but their chunk text changed under a reused id.\n'
    );

    return dangling.length + rewritten.length;
  }
}

const since = CitationAudit.parseSince(process.argv);
CitationAudit.run(since)
  .then(async (findings) => {
    const mgr = MongooseConnectionManager.getExistingInstance();
    if (mgr) await mgr.disconnectAll();
    process.exit(findings > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
