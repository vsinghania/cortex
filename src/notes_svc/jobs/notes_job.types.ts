import { z } from 'zod';

/**
 * Job names owned by notes_svc. Declared here rather than in jobs_svc so the queue
 * module never names a domain concept - see scripts/layering.test.ts.
 */
export const NotesJobName = {
  NotesReindex: 'notes_reindex'
} as const;

export const MAX_REINDEX_USER_IDS = 500;
export const MAX_REINDEX_NOTE_IDS = 1000;

/**
 * `rechunk` re-chunks with the current CHUNK_* settings and reuses any chunk whose
 * content hash is unchanged, so a full sweep is near-free when only offsets need
 * refreshing. `reembed` deletes chunks first, so every chunk is re-embedded - real
 * OpenAI spend.
 */
export const NotesReindexPayloadSchema = z
  .object({
    mode: z.enum(['rechunk', 'reembed']),
    user_ids: z.array(z.string().min(1)).min(1).max(MAX_REINDEX_USER_IDS).optional(),
    note_ids: z.array(z.string().min(1)).min(1).max(MAX_REINDEX_NOTE_IDS).optional(),
    dry_run: z.boolean().default(false)
  })
  .strict();

export type NotesReindexPayload = z.infer<typeof NotesReindexPayloadSchema>;

export type NotesReindexCheckpoint = {
  after_id?: string;
};
