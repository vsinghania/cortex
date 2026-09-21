import { z } from 'zod';

export const OneNoteJobName = {
  /** One user's sync pass. */
  OneNoteSync: 'onenote_sync',
  /** System-wide fan-out: enqueues a sync per connected account. */
  OneNoteSyncSweep: 'onenote_sync_sweep'
} as const;

/**
 * Optionals are `.nullish()` throughout, not `.optional()`: BSON round-trips `undefined`
 * to `null`, so a payload written by attempt one is rejected by its own schema on attempt
 * two (docs/jobs_svc.md §7), and a rejected payload is a permanent failure.
 */
/**
 * Where a paused pass left off. It travels in the payload rather than the job's own
 * checkpoint because a continuation is a *new* job: the queue's checkpoint only survives
 * retries of the same job, and using retries for continuation would spend the attempt
 * budget and back off exponentially between segments.
 */
const ResumeSchema = z
  .object({
    section_cursor: z.string().nullish(),
    page_next_link: z.string().nullish(),
    watermark_candidate: z.string().nullish(),
    pages_seen: z.number().int().nonnegative().nullish()
  })
  .strict()
  .nullish();

export const OneNoteSyncPayloadSchema = z
  .object({
    user_id: z.string().min(1),
    mode: z.enum(['incremental', 'full']).default('incremental'),
    reason: z.enum(['manual', 'scheduled', 'continuation']).default('scheduled'),
    /** Absent means every selected notebook; a scope narrows the pass to these. */
    notebook_ids: z.array(z.string().min(1).max(512)).max(100).nullish(),
    resume: ResumeSchema
  })
  .strict();

export const OneNoteSyncSweepPayloadSchema = z.object({}).strict();

export type OneNoteSyncPayload = z.infer<typeof OneNoteSyncPayloadSchema>;
export type OneNoteSyncSweepPayload = z.infer<typeof OneNoteSyncSweepPayloadSchema>;

/** One sync per connection at a time; a "Sync now" during a run joins the running job. */
export class OneNoteJobKeys {
  private constructor() {}

  static syncDedupKey(user_id: string): string {
    return `onenote-sync:${user_id}`;
  }
}
