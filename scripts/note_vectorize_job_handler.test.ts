import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteVectorizeJobHandler } from '../src/notes_svc/jobs/note_vectorize_job_handler.js';
import type { Note } from '../src/notes_svc/types/note.types.js';
import { NoteSource, SyncStatus } from '../src/notes_svc/types/note.types.js';
import { JobRunContext } from '../src/jobs_svc/worker/job_run_context.js';
import { JobStatus } from '../src/jobs_svc/types/job.types.js';

const payload = { user_id: 'user-a', note_id: 'n-1' };

function buildNote(body: string, over: Partial<Note> = {}): Note {
  const now = new Date();
  return {
    id: payload.note_id,
    user_id: payload.user_id,
    source: NoteSource.Native,
    title: 'title',
    body,
    tags: [],
    sync_status: SyncStatus.Idle,
    is_archived: false,
    is_pinned: false,
    is_deleted: false,
    created_at: now,
    updated_at: now,
    ...over
  } as Note;
}

/** Serves successive reads from `reads`, repeating the last one once exhausted. */
function fakeNotesRepo(reads: Array<Note | null>) {
  let i = 0;
  return {
    getNoteById: async () => reads[Math.min(i++, reads.length - 1)]
  } as any;
}

function fakeVectorizationSvc(fail = false) {
  const bodies: string[] = [];
  return {
    svc: {
      vectorizeNote: async (note: Note) => {
        if (fail) throw new Error('embeddings down');
        bodies.push(note.body);
      }
    } as any,
    bodies
  };
}

function buildContext(): JobRunContext {
  const now = new Date();
  return JobRunContext.forJob({
    id: 'job-1',
    name: 'note_vectorize',
    payload,
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
    updated_at: now
  });
}

async function handlerFor(reads: Array<Note | null>, fail = false) {
  const { svc, bodies } = fakeVectorizationSvc(fail);
  const handler = await NoteVectorizeJobHandler.create({ notes_repo: fakeNotesRepo(reads), vectorization_svc: svc });
  return { handler, bodies };
}

test('embeds once when the body is stable', async () => {
  const note = buildNote('v1');
  const { handler, bodies } = await handlerFor([note, note]);

  const result = await handler.handle(payload, buildContext());

  assert.deepEqual(bodies, ['v1']);
  assert.deepEqual(result, { outcome: 'succeeded', summary: { passes: 1 } });
});

test('ignores timestamp-only changes such as the vectorization status write', async () => {
  const note = buildNote('v1');
  const restamped = buildNote('v1', { updated_at: new Date(Date.now() + 1000) });
  const { handler, bodies } = await handlerFor([note, restamped]);

  await handler.handle(payload, buildContext());

  assert.deepEqual(bodies, ['v1']);
});

test('runs another pass when the body changed mid-embed', async () => {
  const { handler, bodies } = await handlerFor([buildNote('v1'), buildNote('v2'), buildNote('v2')]);

  const result = await handler.handle(payload, buildContext());

  assert.deepEqual(bodies, ['v1', 'v2']);
  assert.deepEqual(result, { outcome: 'succeeded', summary: { passes: 2 } });
});

test('stops after the pass cap under sustained edits', async () => {
  const reads = ['v1', 'v2', 'v3', 'v4', 'v5'].map((b) => buildNote(b));
  const { handler, bodies } = await handlerFor(reads);

  await handler.handle(payload, buildContext());

  assert.deepEqual(bodies, ['v1', 'v2', 'v3']);
});

test('skips a note that was deleted before the job ran', async () => {
  const { handler, bodies } = await handlerFor([null]);
  const result = await handler.handle(payload, buildContext());
  assert.deepEqual(bodies, []);
  assert.deepEqual(result, { outcome: 'succeeded', summary: { skipped: true } });

  const flagged = await handlerFor([buildNote('v1', { is_deleted: true })]);
  await flagged.handler.handle(payload, buildContext());
  assert.deepEqual(flagged.bodies, []);
});

test('reports a retryable failure when embedding throws', async () => {
  const { handler } = await handlerFor([buildNote('v1')], true);
  const result = await handler.handle(payload, buildContext());
  assert.deepEqual(result, { outcome: 'failed', reason: 'embeddings down', retryable: true });
});

test('rejects a payload without a user scope', async () => {
  const { handler } = await handlerFor([null]);
  assert.throws(() => handler.parsePayload({ note_id: 'n-1' }));
});
