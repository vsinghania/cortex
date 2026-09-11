import assert from 'node:assert/strict';
import test from 'node:test';
import { NotesReindexJobHandler } from '../src/notes_svc/jobs/notes_reindex_job_handler.js';
import type { Note } from '../src/notes_svc/types/note.types.js';
import { NoteSource, SyncStatus } from '../src/notes_svc/types/note.types.js';
import { JobRunContext } from '../src/jobs_svc/worker/job_run_context.js';
import { JobStatus, type Job } from '../src/jobs_svc/types/job.types.js';

function buildNote(id: string, user_id = 'user-a'): Note {
  const now = new Date();
  return {
    id,
    user_id,
    source: NoteSource.Local,
    title: id,
    body: 'body',
    tags: [],
    sync_status: SyncStatus.Idle,
    is_archived: false,
    is_deleted: false,
    created_at: now,
    updated_at: now
  } as Note;
}

/** Stands in for MongooseNoteRepository, honouring the cursor and the filters. */
function fakeNotesRepo(notes: Note[]) {
  const select = (p: { user_ids?: string[]; note_ids?: string[]; after_id?: string }) =>
    notes
      .filter((n) => !p.user_ids?.length || p.user_ids.includes(n.user_id))
      .filter((n) => !p.note_ids?.length || p.note_ids.includes(n.id))
      .filter((n) => !p.after_id || n.id > p.after_id)
      .sort((a, b) => a.id.localeCompare(b.id));

  return {
    listNotesForMaintenance: async (p: any) => select(p).slice(0, p.limit),
    countNotesForMaintenance: async (p: any) => select(p).length
  } as any;
}

function fakeVectorizationSvc(onNote?: (note_id: string) => void) {
  const seen: string[] = [];
  return {
    svc: {
      vectorizeNote: async (note: Note) => {
        seen.push(note.id);
        onNote?.(note.id);
      },
      revectorizeNote: async (p: { note_id: string }) => {
        seen.push(p.note_id);
        onNote?.(p.note_id);
      }
    } as any,
    seen
  };
}

/**
 * The real JobRunContext, not a double. It needs no I/O to construct, and using it
 * means the seeding, error-capping and abort bookkeeping under test are the ones
 * that actually run in production - a hand-rolled fake would be free to disagree
 * with them, which is exactly what the resume case checks.
 */
function buildContext(over: Partial<Job> = {}): JobRunContext {
  const now = new Date();
  return JobRunContext.forJob({
    id: 'job-1',
    name: 'notes_reindex',
    payload: {},
    status: JobStatus.Running,
    attempts: 1,
    max_attempts: 3,
    run_at: now,
    visible_at: now,
    locked_by: 'ctr-1',
    locked_at: now,
    lease_expires_at: now,
    reclaimed_count: 0,
    cancel_requested: false,
    progress: { processed: 0, succeeded: 0, failed: 0 },
    errors: [],
    created_at: now,
    updated_at: now,
    ...over
  });
}

const notes = ['n-01', 'n-02', 'n-03'].map((id) => buildNote(id));

test('processes every selected note and advances the checkpoint', async () => {
  const { svc, seen } = fakeVectorizationSvc();
  const handler = await NotesReindexJobHandler.create({
    notes_repo: fakeNotesRepo(notes),
    vectorization_svc: svc
  });
  const ctx = buildContext();

  const result = await handler.handle({ mode: 'rechunk', dry_run: false }, ctx);

  assert.equal(result.outcome, 'succeeded');
  assert.deepEqual(seen, ['n-01', 'n-02', 'n-03']);
  assert.equal(ctx.snapshotProgress().processed, 3);
  assert.equal(ctx.snapshotProgress().succeeded, 3);
  assert.deepEqual(ctx.snapshotCheckpoint(), { after_id: 'n-03' });
});

test('honours a user_ids filter', async () => {
  const mixed = [buildNote('n-01', 'xyz'), buildNote('n-02', 'abc'), buildNote('n-03', 'xyz')];
  const { svc, seen } = fakeVectorizationSvc();
  const handler = await NotesReindexJobHandler.create({
    notes_repo: fakeNotesRepo(mixed),
    vectorization_svc: svc
  });

  await handler.handle({ mode: 'rechunk', user_ids: ['xyz'], dry_run: false }, buildContext());
  assert.deepEqual(seen, ['n-01', 'n-03']);
});

test('honours a note_ids filter', async () => {
  const { svc, seen } = fakeVectorizationSvc();
  const handler = await NotesReindexJobHandler.create({
    notes_repo: fakeNotesRepo(notes),
    vectorization_svc: svc
  });

  await handler.handle({ mode: 'rechunk', note_ids: ['n-02'], dry_run: false }, buildContext());
  assert.deepEqual(seen, ['n-02']);
});

test('resuming from a checkpoint skips already-processed notes and keeps counters', async () => {
  const { svc, seen } = fakeVectorizationSvc();
  const handler = await NotesReindexJobHandler.create({
    notes_repo: fakeNotesRepo(notes),
    vectorization_svc: svc
  });

  // What a reclaimed job carries: the cursor, and the counts from the last attempt.
  const ctx = buildContext({
    checkpoint: { after_id: 'n-02' },
    progress: { processed: 2, succeeded: 2, failed: 0 }
  });

  await handler.handle({ mode: 'rechunk', dry_run: false }, ctx);

  assert.deepEqual(seen, ['n-03'], 'must not redo notes before the cursor');
  assert.equal(ctx.snapshotProgress().processed, 3, 'processed must continue, not restart');
  assert.equal(ctx.snapshotProgress().succeeded, 3);
});

test('a per-note failure is counted and the sweep continues', async () => {
  const { svc } = fakeVectorizationSvc((note_id) => {
    if (note_id === 'n-02') throw new Error('embedding blew up');
  });
  const handler = await NotesReindexJobHandler.create({
    notes_repo: fakeNotesRepo(notes),
    vectorization_svc: svc
  });
  const ctx = buildContext();

  const result = await handler.handle({ mode: 'rechunk', dry_run: false }, ctx);

  assert.equal(result.outcome, 'succeeded', 'one bad note must not fail the whole sweep');
  assert.equal(ctx.snapshotProgress().processed, 3);
  assert.equal(ctx.snapshotProgress().succeeded, 2);
  assert.equal(ctx.snapshotProgress().failed, 1);
  assert.equal(ctx.snapshotErrors().length, 1);
});

test('dry_run reports the selection without processing anything', async () => {
  const { svc, seen } = fakeVectorizationSvc();
  const handler = await NotesReindexJobHandler.create({
    notes_repo: fakeNotesRepo(notes),
    vectorization_svc: svc
  });
  const ctx = buildContext();

  const result = await handler.handle({ mode: 'reembed', dry_run: true }, ctx);

  assert.deepEqual(seen, []);
  assert.equal(ctx.snapshotProgress().total, 3);
  assert.equal(ctx.snapshotProgress().processed, 0);
  if (result.outcome === 'succeeded') assert.deepEqual(result.summary, { dry_run: true, selected: 3 });
});

test('a cancellation halts between notes, keeping work already done', async () => {
  // Cancel the way the worker does - via the context's own abort - rather than by
  // swapping in a foreign AbortSignal.
  const ctx = buildContext();
  const { svc, seen } = fakeVectorizationSvc((note_id) => {
    if (note_id === 'n-01') ctx.abort('cancelled');
  });
  const handler = await NotesReindexJobHandler.create({
    notes_repo: fakeNotesRepo(notes),
    vectorization_svc: svc
  });

  await handler.handle({ mode: 'rechunk', dry_run: false }, ctx);
  assert.equal(ctx.getAbortReason(), 'cancelled');

  assert.deepEqual(seen, ['n-01'], 'must stop at the next note boundary');
  assert.equal(ctx.snapshotProgress().processed, 1);
  assert.deepEqual(ctx.snapshotCheckpoint(), { after_id: 'n-01' }, 'the cursor must be kept');
});

test('reembed routes to revectorizeNote rather than vectorizeNote', async () => {
  const calls: string[] = [];
  const svc = {
    vectorizeNote: async () => {
      calls.push('vectorize');
    },
    revectorizeNote: async () => {
      calls.push('revectorize');
    }
  } as any;

  const handler = await NotesReindexJobHandler.create({
    notes_repo: fakeNotesRepo([notes[0]]),
    vectorization_svc: svc
  });

  await handler.handle({ mode: 'reembed', dry_run: false }, buildContext());
  assert.deepEqual(calls, ['revectorize']);
});

test('parsePayload rejects an unknown field rather than silently ignoring it', () => {
  const handler = Object.create(NotesReindexJobHandler.prototype) as NotesReindexJobHandler;
  assert.throws(() => handler.parsePayload({ mode: 'rechunk', bogus: 1 } as any));
  assert.throws(() => handler.parsePayload({ mode: 'nonsense' } as any));
});
