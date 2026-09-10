import type { JobSchedule, UpsertScheduleInput } from './types/job_schedule.types.js';
import type { JobScheduleRepository } from './repositories/job_schedule_repository_interface.js';
import { MongooseJobScheduleRepository } from './repositories/mongoose_job_schedule_repository.js';
import { ScheduleClock } from './schedule_clock.js';
import { JobsSvc } from './jobs_svc.js';
import { ConflictError } from '../common/errors.js';
import { TraceContext } from '../common/trace_context.js';
import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';

const TICK_INTERVAL_MS = Time.secondsToMs(30);
/**
 * Lateness beyond which a tick counts as a missed window rather than a normal
 * one. Two ticks of slack, so ordinary jitter never looks like downtime.
 */
const STALE_AFTER_MS = TICK_INTERVAL_MS * 2;
const DUE_BATCH_LIMIT = 20;

/**
 * Materializes due recurring schedules into concrete jobs.
 *
 * Owns no execution: it inserts rows into `jobs` and the worker takes them from
 * there, so a schedule and a one-shot enqueue are indistinguishable downstream.
 */
export class JobScheduler {
  private tick_timer: NodeJS.Timeout | null = null;
  private tick_in_flight = false;

  private constructor(
    private readonly repo: JobScheduleRepository,
    private readonly jobs_svc: JobsSvc
  ) {}

  static async create(): Promise<JobScheduler> {
    return new JobScheduler(await MongooseJobScheduleRepository.create(), await JobsSvc.getInstance());
  }

  start(): void {
    if (this.tick_timer) return;

    this.tick_timer = setInterval(async () => {
      if (this.tick_in_flight) return;
      this.tick_in_flight = true;
      TraceContext.enterBackground('job-scheduler');
      try {
        await this.tick();
      } catch (err) {
        logger.warn({ err }, 'job scheduler tick failed');
      } finally {
        this.tick_in_flight = false;
      }
    }, TICK_INTERVAL_MS);

    this.tick_timer.unref?.();
    logger.info({ interval_ms: TICK_INTERVAL_MS }, 'job scheduler started');
  }

  stop(): void {
    if (!this.tick_timer) return;
    clearInterval(this.tick_timer);
    this.tick_timer = null;
    logger.info('job scheduler stopped');
  }

  /** Registers or updates a schedule. Idempotent on `id`, so it is safe at boot. */
  async upsertSchedule(input: UpsertScheduleInput): Promise<JobSchedule> {
    ScheduleClock.assertValid(input.schedule);

    const now = new Date();
    const schedule: JobSchedule = {
      id: input.id,
      name: input.name,
      label: input.label,
      payload: input.payload,
      dedup_key: input.dedup_key,
      user_id: input.user_id,
      enabled: input.enabled ?? true,
      schedule: input.schedule,
      max_attempts: input.max_attempts ?? 1,
      catchup: input.catchup ?? true,
      // Seeded only on insert; an existing schedule keeps the firing it is
      // already counting down to.
      next_run_at: ScheduleClock.nextRunAt({ schedule: input.schedule, from: now }),
      created_by: input.created_by,
      created_at: now,
      updated_at: now
    };

    const saved = await this.repo.upsert({ schedule });
    logger.info(
      { schedule_id: saved.id, job_name: saved.name, kind: saved.schedule.kind, next_run_at: saved.next_run_at },
      'job schedule registered'
    );
    return saved;
  }

  async listSchedules(params?: { enabled?: boolean }): Promise<JobSchedule[]> {
    return this.repo.list(params);
  }

  async setScheduleEnabled(params: { id: string; enabled: boolean }): Promise<JobSchedule | null> {
    const existing = await this.repo.getById(params.id);
    if (!existing) return null;

    // A schedule disabled for a week would otherwise fire the instant it returns.
    const next_run_at = params.enabled
      ? ScheduleClock.nextRunAt({ schedule: existing.schedule, from: new Date() })
      : undefined;

    return this.repo.setEnabled({ ...params, next_run_at });
  }

  /** One pass over everything due. Exposed for tests and smoke scripts. */
  async tick(now: Date = new Date()): Promise<number> {
    const due = await this.repo.listDue({ now, limit: DUE_BATCH_LIMIT });
    let spawned = 0;

    for (const schedule of due) {
      if (await this.materialize(schedule, now)) spawned++;
    }
    return spawned;
  }

  private async materialize(schedule: JobSchedule, now: Date): Promise<boolean> {
    const resolution = ScheduleClock.resolveDue({
      schedule: schedule.schedule,
      next_run_at: schedule.next_run_at,
      now,
      catchup: schedule.catchup,
      stale_after_ms: STALE_AFTER_MS
    });

    // Advance first. Losing this race means another container owns the run.
    const claimed = await this.repo.claimDue({
      id: schedule.id,
      expected_next_run_at: schedule.next_run_at,
      next_run_at: resolution.next_run_at,
      now
    });
    if (!claimed) return false;

    if (!resolution.spawn) {
      logger.warn(
        {
          schedule_id: schedule.id,
          job_name: schedule.name,
          lateness_ms: resolution.lateness_ms,
          next_run_at: resolution.next_run_at
        },
        'job schedule window missed; skipped rather than fired late (catchup disabled)'
      );
      return false;
    }

    try {
      const { job_id } = await this.jobs_svc.enqueue({
        name: schedule.name,
        payload: schedule.payload,
        user_id: schedule.user_id,
        dedup_key: schedule.dedup_key,
        schedule_id: schedule.id,
        max_attempts: schedule.max_attempts
      });

      await this.repo.recordRun({ id: schedule.id, last_job_id: job_id });
      logger.info(
        { schedule_id: schedule.id, job_name: schedule.name, job_id, lateness_ms: resolution.lateness_ms },
        'job schedule fired'
      );
      return true;
    } catch (err) {
      if (err instanceof ConflictError) {
        // The previous run is still active. Overrun is refused by the job queue's
        // own single-flight index, so this needs no separate guard - and
        // next_run_at has already advanced, so the following window is unaffected.
        logger.warn(
          { schedule_id: schedule.id, job_name: schedule.name },
          'job schedule overran its previous run; this window skipped'
        );
        return false;
      }
      // next_run_at is already advanced, so this skips a run rather than retrying
      // forever - the safer direction to fail.
      logger.error({ err, schedule_id: schedule.id, job_name: schedule.name }, 'job schedule failed to enqueue');
      return false;
    }
  }
}
