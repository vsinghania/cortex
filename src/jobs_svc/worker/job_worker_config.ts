import os from 'node:os';
import { z } from 'zod';
import type { RetryPolicy } from '../types/job.types.js';
import { Id } from '../../lib/id.js';
import { Time } from '../../lib/time.js';

const WORKER_ID_SUFFIX_LEN = 6;

export type JobWorkerConfig = {
  /** hostname is the container id under Docker, so this is unique per worker. */
  worker_id: string;
  scheduler_enabled: boolean;
  concurrency: number;
  poll_interval_ms: number;
  /** +/- this fraction, so N workers do not poll in lockstep. */
  poll_jitter_ratio: number;
  poll_max_interval_ms: number;
  lease_ms: number;
  drain_deadline_ms: number;
  /** Backoff before re-offering a job whose handler this worker lacks. */
  unknown_handler_delay_ms: number;
  default_retry_policy: RetryPolicy;
  succeeded_retention_sec: number;
  failed_retention_sec: number;
};

const EnvSchema = z.object({
  JOBS_SCHEDULER_ENABLED: z.string().optional(),
  JOBS_CONCURRENCY: z.coerce.number().int().min(1).max(64).optional(),
  JOBS_POLL_INTERVAL_MS: z.coerce.number().int().min(100).optional(),
  JOBS_POLL_MAX_INTERVAL_MS: z.coerce.number().int().min(100).optional(),
  JOBS_LEASE_MS: z.coerce.number().int().min(1000).optional(),
  JOBS_DRAIN_DEADLINE_MS: z.coerce.number().int().min(0).optional(),
  JOBS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).optional()
});

export class JobWorkerConfigLoader {
  private constructor() {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): JobWorkerConfig {
    const parsed = EnvSchema.parse(env);

    return {
      worker_id: JobWorkerConfigLoader.buildWorkerId(),
      scheduler_enabled: JobWorkerConfigLoader.parseBooleanSetting(parsed.JOBS_SCHEDULER_ENABLED, true),

      // 1 by design: the re-index is serial, and parallel embedding risks rate limits.
      concurrency: parsed.JOBS_CONCURRENCY ?? 1,

      poll_interval_ms: parsed.JOBS_POLL_INTERVAL_MS ?? Time.secondsToMs(2),
      poll_jitter_ratio: 0.2,
      poll_max_interval_ms: parsed.JOBS_POLL_MAX_INTERVAL_MS ?? Time.secondsToMs(10),

      lease_ms: parsed.JOBS_LEASE_MS ?? Time.minutesToMs(2),
      // 5s of margin inside the compose stop_grace_period of 30s.
      drain_deadline_ms: parsed.JOBS_DRAIN_DEADLINE_MS ?? Time.secondsToMs(25),
      unknown_handler_delay_ms: Time.secondsToMs(30),

      default_retry_policy: {
        max_attempts: parsed.JOBS_MAX_ATTEMPTS ?? 3,
        base_delay_ms: Time.secondsToMs(2),
        max_delay_ms: Time.minutesToMs(5),
        jitter: 'full'
      },

      succeeded_retention_sec: Time.daysToSec(3),
      failed_retention_sec: Time.daysToSec(14)
    };
  }

  private static buildWorkerId(): string {
    return `${os.hostname()}:${process.pid}:${Id.generateRandom(WORKER_ID_SUFFIX_LEN)}`;
  }

  private static parseBooleanSetting(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined || raw.trim() === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }
}
