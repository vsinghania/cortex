import type { Note } from '../types/note.types.js';
import type { NoteRepository } from '../repositories/note_repository_interface.js';
import { MongooseNoteRepository } from '../repositories/mongoose_note_repository.js';
import { NotesVectorizationSvc } from '../notes_vectorization_svc.js';
import { NotesJobName, NoteVectorizePayloadSchema, type NoteVectorizePayload } from './notes_job.types.js';
import type { JobPayload, RetryPolicy } from '../../jobs_svc/types/job.types.js';
import type { JobContext, JobHandler, JobResult } from '../../jobs_svc/types/job_handler.types.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';
import { logger } from '../../common/logger.js';
import { Time } from '../../lib/time.js';

/**
 * Bounds the catch-up loop. Each extra pass only happens when the body changed while
 * the previous one was embedding, so hitting the cap means sustained typing - the
 * next edit after it settles enqueues a fresh job.
 */
const MAX_VECTORIZE_PASSES = 3;

/**
 * Deferred, coalesced vectorization for one note, enqueued by NotesSvc on edits
 * with `indexing: 'deferred'`. The job reads the note when it runs rather than
 * carrying a body, so a burst of autosaves collapses into a single embed.
 */
export class NoteVectorizeJobHandler implements JobHandler<NoteVectorizePayload> {
  readonly name = NotesJobName.NoteVectorize;
  readonly lease_ms = Time.minutesToMs(5);
  readonly retry_policy: Partial<RetryPolicy> = { max_attempts: 3 };

  private constructor(
    private readonly notes_repo: NoteRepository,
    private readonly vectorization_svc: NotesVectorizationSvc
  ) {}

  static async create(params?: {
    notes_repo?: NoteRepository;
    vectorization_svc?: NotesVectorizationSvc;
  }): Promise<NoteVectorizeJobHandler> {
    const notes_repo =
      params?.notes_repo ?? (await MongooseNoteRepository.create({ db: DbNameResolver.resolve('notes') }));
    const vectorization_svc = params?.vectorization_svc ?? (await NotesVectorizationSvc.create());
    return new NoteVectorizeJobHandler(notes_repo, vectorization_svc);
  }

  parsePayload(raw: JobPayload): NoteVectorizePayload {
    return NoteVectorizePayloadSchema.parse(raw);
  }

  async handle(payload: NoteVectorizePayload, ctx: JobContext): Promise<JobResult> {
    const start_ms = performance.now();
    let note = await this.findLiveNote(payload);
    if (!note) {
      logger.info({ note_id: payload.note_id, reason: 'note_gone' }, 'note vectorize skipped');
      return { outcome: 'succeeded', summary: { skipped: true } };
    }

    let passes = 0;
    try {
      while (note && passes < MAX_VECTORIZE_PASSES && !ctx.signal.aborted) {
        passes++;
        await this.vectorization_svc.vectorizeNote(note);
        note = await this.findNoteChangedSinceVectorization(note, payload);
      }
    } catch (err) {
      logger.error({ err, note_id: payload.note_id, passes }, 'note vectorize failed');
      return { outcome: 'failed', reason: (err as Error)?.message ?? 'unknown error', retryable: true };
    }

    if (note) {
      logger.warn({ note_id: payload.note_id, passes }, 'note vectorize passes exhausted');
    }
    logger.info(
      { note_id: payload.note_id, passes, duration_ms: Time.elapsedMs(start_ms) },
      'note vectorize completed'
    );
    return { outcome: 'succeeded', summary: { passes } };
  }

  private async findLiveNote(payload: NoteVectorizePayload): Promise<Note | null> {
    const note = await this.notes_repo.getNoteById({ user_id: payload.user_id, id: payload.note_id });
    return note && !note.is_deleted ? note : null;
  }

  /**
   * Compares bodies rather than updated_at: persisting the vectorization status is
   * itself a write that bumps the timestamp.
   */
  private async findNoteChangedSinceVectorization(vectorized: Note, payload: NoteVectorizePayload): Promise<Note | null> {
    const latest = await this.findLiveNote(payload);
    return latest && latest.body !== vectorized.body ? latest : null;
  }
}
