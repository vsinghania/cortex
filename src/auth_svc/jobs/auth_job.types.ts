import { z } from 'zod';

/**
 * Job names owned by auth_svc. Declared here rather than in jobs_svc so the queue
 * module never names a domain concept - see scripts/layering.test.ts.
 */
export const AuthJobName = {
  RefreshTokenPrune: 'refresh_token_prune'
} as const;

export const DEFAULT_PRUNE_BATCH = 1000;

/**
 * `nullish` rather than `optional`: a payload round-trips through Mongo, which
 * serializes undefined to null, so an omitted field comes back as null.
 */
export const RefreshTokenPrunePayloadSchema = z
  .object({
    batch_limit: z.number().int().positive().max(10_000).nullish().transform((v) => v ?? DEFAULT_PRUNE_BATCH)
  })
  .strict();

export type RefreshTokenPrunePayload = z.infer<typeof RefreshTokenPrunePayloadSchema>;
