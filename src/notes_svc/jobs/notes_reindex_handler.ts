import type { Note } from '../types/note.types.js';
import type { NoteRepository } from '../repositories/note_repository_interface.js';
import { MongooseNoteRepository } from '../repositories/mongoose_note_repository.js';
import { NotesVectorizationSvc } from '../notes_vectorization_svc.js';
import {
  NotesJobName,
  NotesReindexPayloadSchema,
  type NotesReindexCheckpoint,
  type NotesReindexPayload
} from './notes_job.types.js';
import type { JobPayload, RetryPolicy } from '../../jobs_svc/types/job.types.js';
import type { JobContext, JobHandler, JobResult } from '../../jobs_svc/types/job_handler.types.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';
import { logger } from '../../common/logger.js';
import { Time } from '../../lib/time.js';

const PAGE_SIZE = 100;

/**
 * Admin-triggered re-chunk / re-embed sweep.
 *
 * Cross-user by design: an empty filter targets every note in the system. The
 * selection comes from `payload.user_ids` ONLY - never from ctx.user_id, which is
 * the requesting admin and is an audit field, not a tenant scope.
 */
export class NotesReindexHandler implements JobHandler<NotesReindexPayload> {
  readonly name = NotesJobName.NotesReindex;
  // Embedding calls are slow: 20s timeout x 3 retries x ceil(chunks/96) batches,
  // so one note can outlast a default lease on its own.
  readonly lease_ms = Time.minutesToMs(5);
  // A crash-resume budget, not a per-note one: per-note failures are counted and
  // the sweep continues.
  readonly retry_policy: Partial<RetryPolicy> = { max_attempts: 3 };

  private constructor(
    private readonly notes_repo: NoteRepository,
    private readonly vectorization_svc: NotesVectorizationSvc
  ) {}

  static async create(params?: {
    notes_repo?: NoteRepository;
    vectorization_svc?: NotesVectorizationSvc;
  }): Promise<NotesReindexHandler> {
    const notes_repo =
      params?.notes_repo ?? (await MongooseNoteRepository.create({ db: DbNameResolver.resolve('notes') }));
    const vectorization_svc = params?.vectorization_svc ?? (await NotesVectorizationSvc.create());
    return new NotesReindexHandler(notes_repo, vectorization_svc);
  }

  parsePayload(raw: JobPayload): NotesReindexPayload {
    return NotesReindexPayloadSchema.parse(raw);
  }

  async handle(payload: NotesReindexPayload, ctx: JobContext): Promise<JobResult> {
    const checkpoint = (ctx.checkpoint ?? {}) as NotesReindexCheckpoint;
    const total = await this.notes_repo.countNotesForMaintenance({
      user_ids: payload.user_ids,
      note_ids: payload.note_ids
    });

    if (payload.dry_run) {
      ctx.reportProgress({ total, processed: 0, succeeded: 0, failed: 0 });
      logger.info({ job_id: ctx.job_id, mode: payload.mode, total }, 'notes reindex dry run resolved');
      return { outcome: 'succeeded', summary: { dry_run: true, selected: total } };
    }

    // Seeded from the previous attempt so a resumed sweep continues its counters
    // rather than restarting them at zero.
    let processed = ctx.progress.processed;
    let succeeded = ctx.progress.succeeded;
    let failed = ctx.progress.failed;
    let after_id = checkpoint.after_id;

    ctx.reportProgress({ total, processed, succeeded, failed });

    while (!ctx.signal.aborted) {
      const page = await this.notes_repo.listNotesForMaintenance({
        user_ids: payload.user_ids,
        note_ids: payload.note_ids,
        after_id,
        limit: PAGE_SIZE
      });
      if (page.length === 0) break;

      for (const note of page) {
        if (ctx.signal.aborted) break;

        // Serial on purpose: embedding calls are rate-limited, and parallelism here
        // buys little while risking 429s.
        const ok = await this.reindexNote(note, payload.mode, ctx);
        processed++;
        if (ok) succeeded++;
        else failed++;

        after_id = note.id;
        ctx.setCheckpoint({ after_id } satisfies NotesReindexCheckpoint);
        ctx.reportProgress({ total, processed, succeeded, failed });
      }
    }

    logger.info(
      { job_id: ctx.job_id, mode: payload.mode, total, processed, succeeded, failed },
      ctx.signal.aborted ? 'notes reindex interrupted' : 'notes reindex completed'
    );

    return { outcome: 'succeeded', summary: { mode: payload.mode, total, processed, succeeded, failed } };
  }

  /** Per-note failures are counted and recorded; the sweep continues. */
  private async reindexNote(
    note: Note,
    mode: NotesReindexPayload['mode'],
    ctx: JobContext
  ): Promise<boolean> {
    try {
      if (mode === 'reembed') {
        await this.vectorization_svc.revectorizeNote({ user_id: note.user_id, note_id: note.id });
      } else {
        await this.vectorization_svc.vectorizeNote(note);
      }
      return true;
    } catch (err) {
      // vectorizeNote already persists vectorization.status = 'error' on the note,
      // so the failure is durable and the note stays re-selectable.
      ctx.recordError({ item_id: note.id, message: (err as Error)?.message ?? 'unknown error' });
      logger.warn({ err, note_id: note.id, job_id: ctx.job_id }, 'notes reindex failed for note');
      return false;
    }
  }
}
