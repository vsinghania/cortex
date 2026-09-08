import { performance } from 'node:perf_hooks';
import type { Job, RetryPolicy } from '../types/job.types.js';
import type { JobResult } from '../types/job_handler.types.js';
import type { JobRepository } from '../repositories/job_repository_interface.js';
import { MongooseJobRepository } from '../repositories/mongoose_job_repository.js';
import { JobHandlerRegistry } from '../handlers/job_handler_registry.js';
import { JobRunContext } from './job_run_context.js';
import { JobLease } from './job_lease.js';
import { JobRetryDecision } from './job_retry_decision.js';
import { JobErrorPolicy } from '../job_errors.js';
import { type JobWorkerConfig, JobWorkerConfigLoader } from './job_worker_config.js';
import { TraceContext } from '../../common/trace_context.js';
import { logger } from '../../common/logger.js';
import { Id } from '../../lib/id.js';
import { Time } from '../../lib/time.js';

const JOB_TRACE_ID_LEN = 8;
const DRAIN_POLL_MS = 100;

export type WorkerStats = {
  worker_id: string;
  in_flight: number;
  claimed_total: number;
  succeeded_total: number;
  failed_total: number;
};

export class JobWorker {
  private readonly in_flight = new Map<string, JobRunContext>();
  private poll_timer: NodeJS.Timeout | null = null;
  private tick_in_flight = false;
  private stopping = false;
  private empty_polls = 0;

  private claimed_total = 0;
  private succeeded_total = 0;
  private failed_total = 0;

  private constructor(
    private readonly repo: JobRepository,
    private readonly registry: JobHandlerRegistry,
    private readonly config: JobWorkerConfig
  ) {}

  /**
   * Throws when the registry is empty. Such a worker would claim jobs and release
   * every one of them unrun - a hot loop that looks healthy. That is always a
   * misconfiguration: JOBS_WORKER_ENABLED=false is the explicit way to run a
   * process that does not work jobs.
   */
  static async create(params?: {
    repo?: JobRepository;
    registry?: JobHandlerRegistry;
    config?: Partial<JobWorkerConfig>;
  }): Promise<JobWorker> {
    const registry = params?.registry ?? JobHandlerRegistry.getInstance();
    if (registry.registeredNames().length === 0) {
      throw new Error(
        'JobWorker.create: no job handlers registered. Register handlers at bootstrap, or set JOBS_WORKER_ENABLED=false.'
      );
    }

    const config = { ...JobWorkerConfigLoader.fromEnv(), ...params?.config };
    const repo = params?.repo ?? (await MongooseJobRepository.create());
    return new JobWorker(repo, registry, config);
  }

  start(): void {
    if (this.poll_timer) return;

    this.poll_timer = setInterval(async () => {
      // Re-entrancy guard: a slow tick must not overlap itself.
      if (this.tick_in_flight || this.stopping) return;
      this.tick_in_flight = true;
      TraceContext.enterBackground('jobs-worker');
      try {
        await this.pollOnce();
      } catch (err) {
        logger.warn({ err }, 'job worker poll failed');
      } finally {
        this.tick_in_flight = false;
      }
    }, this.config.poll_interval_ms);

    this.poll_timer.unref?.();
    logger.info(
      {
        worker_id: this.config.worker_id,
        concurrency: this.config.concurrency,
        poll_interval_ms: this.config.poll_interval_ms,
        job_names: this.registry.registeredNames()
      },
      'job worker started'
    );
  }

  /**
   * Drain within the compose stop_grace_period: stop claiming, let in-flight work
   * notice the abort, then hand back whatever is unfinished so the successor
   * container resumes it immediately rather than waiting out the lease.
   */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    if (this.poll_timer) {
      clearInterval(this.poll_timer);
      this.poll_timer = null;
    }

    for (const ctx of this.in_flight.values()) {
      ctx.abort('shutdown');
    }

    const deadline = Date.now() + this.config.drain_deadline_ms;
    while (this.in_flight.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }

    if (this.in_flight.size > 0) {
      logger.warn(
        { worker_id: this.config.worker_id, abandoned: this.in_flight.size },
        'job worker drain deadline reached with work still in flight'
      );
    }

    logger.info({ worker_id: this.config.worker_id, ...this.countersOnly() }, 'job worker stopped');
  }

  getStats(): WorkerStats {
    return { worker_id: this.config.worker_id, in_flight: this.in_flight.size, ...this.countersOnly() };
  }

  private async pollOnce(): Promise<number> {
    let claimed = 0;

    while (!this.stopping && this.in_flight.size < this.config.concurrency) {
      // The default lease, because which handler owns this job is not known until
      // it is claimed. The first heartbeat extends it to the handler's own lease_ms.
      const job = await this.repo.claimNext({
        worker_id: this.config.worker_id,
        lease_ms: this.config.lease_ms,
        now: new Date()
      });
      if (!job) break;

      claimed++;
      this.claimed_total++;
      // Deliberately not awaited: the loop keeps claiming up to the concurrency
      // limit while this one runs. runJob owns all of its own error handling.
      void this.runJob(job);
    }

    this.empty_polls = claimed > 0 ? 0 : this.empty_polls + 1;
    return claimed;
  }

  private async runJob(job: Job): Promise<void> {
    const ctx = JobRunContext.forJob(job);
    this.in_flight.set(job.id, ctx);
    const start_ms = performance.now();

    try {
      await TraceContext.run(
        {
          // New per attempt - retries would otherwise merge into one trace - with
          // upstream_trace_id stitching back to the request that queued the work.
          trace_id: `job:${job.name}:${Id.generateRandom(JOB_TRACE_ID_LEN)}`,
          upstream_trace_id: job.enqueue_trace_id,
          user_id: job.enqueue_user_id
        },
        async () => this.executeJob(job, ctx, start_ms)
      );
    } catch (err) {
      logger.error({ err, job_id: job.id, job_name: job.name }, 'job worker failed outside the handler');
    } finally {
      this.in_flight.delete(job.id);
    }
  }

  private async executeJob(job: Job, ctx: JobRunContext, start_ms: number): Promise<void> {
    if (job.attempts > job.max_attempts) {
      await this.deadLetterExhausted(job);
      return;
    }

    const handler = this.registry.get(job.name);
    if (!handler) {
      // Claimed a job this worker cannot run. Hand it back unrun and unpenalised so
      // a correctly-built worker can take it - never fail it, which would destroy
      // work that is not broken.
      logger.warn(
        { job_id: job.id, job_name: job.name },
        'no handler registered for job; released back to the queue'
      );
      await this.repo.release({
        job_id: job.id,
        worker_id: this.config.worker_id,
        now: new Date(),
        delay_ms: this.config.unknown_handler_delay_ms
      });
      return;
    }

    const lease_ms = this.leaseMsFor(handler.lease_ms);
    const heartbeat = this.startHeartbeat(ctx, lease_ms);

    try {
      const payload = handler.parsePayload(job.payload);
      const result = await handler.handle(payload, ctx);
      await this.writeOutcome({ job, ctx, handler_result: result, start_ms });
    } catch (err) {
      await this.writeOutcome({ job, ctx, err, start_ms });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private startHeartbeat(ctx: JobRunContext, lease_ms: number): NodeJS.Timeout {
    const interval_ms = JobLease.heartbeatIntervalMs(lease_ms);

    const timer = setInterval(async () => {
      try {
        const beat = await this.repo.heartbeat({
          job_id: ctx.job_id,
          worker_id: this.config.worker_id,
          now: new Date(),
          lease_ms,
          progress: ctx.snapshotProgress(),
          checkpoint: ctx.snapshotCheckpoint()
        });

        if (!beat) {
          // The lease was reclaimed by someone else; stop touching this job.
          logger.warn({ job_id: ctx.job_id }, 'job lease lost; aborting handler');
          ctx.abort('lease_lost');
          return;
        }
        if (beat.cancel_requested) ctx.abort('cancelled');
      } catch (err) {
        logger.warn({ err, job_id: ctx.job_id }, 'job heartbeat failed');
      }
    }, interval_ms);

    timer.unref?.();
    return timer;
  }

  private async writeOutcome(params: {
    job: Job;
    ctx: JobRunContext;
    handler_result?: JobResult;
    err?: unknown;
    start_ms: number;
  }): Promise<void> {
    const { job, ctx } = params;
    const lease = { job_id: job.id, worker_id: this.config.worker_id, now: new Date() };
    const duration_ms = Time.elapsedMs(params.start_ms);
    const progress = ctx.snapshotProgress();
    const abort_reason = ctx.getAbortReason();

    // A lost lease means another worker owns the job now - every write would be
    // fenced off anyway, so make none.
    if (abort_reason === 'lease_lost') return;

    if (abort_reason === 'shutdown') {
      await this.repo.release({
        ...lease,
        progress,
        checkpoint: ctx.snapshotCheckpoint()
      });
      logger.info({ job_id: job.id, job_name: job.name, duration_ms }, 'job released for shutdown');
      return;
    }

    if (abort_reason === 'cancelled') {
      await this.repo.cancel({ ...lease, progress, retention_sec: this.config.succeeded_retention_sec });
      logger.info({ job_id: job.id, job_name: job.name, duration_ms, ...progress }, 'job cancelled');
      return;
    }

    const failure = JobWorker.asFailure(params.handler_result, params.err);
    if (!failure) {
      await this.repo.complete({
        ...lease,
        result: params.handler_result?.outcome === 'succeeded' ? params.handler_result.summary : undefined,
        errors: ctx.snapshotErrors(),
        progress,
        retention_sec: this.config.succeeded_retention_sec
      });
      this.succeeded_total++;
      logger.info({ job_id: job.id, job_name: job.name, duration_ms, ...progress }, 'job completed');
      return;
    }

    const decision = JobRetryDecision.decide({
      attempts: job.attempts,
      max_attempts: job.max_attempts,
      err: params.err,
      explicit_retryable: failure.explicit_retryable,
      policy: this.retryPolicyFor(job),
      now: lease.now
    });

    if (decision.outcome === 'retry') {
      await this.repo.retryLater({
        ...lease,
        run_at: decision.run_at,
        message: failure.message,
        progress,
        checkpoint: ctx.snapshotCheckpoint()
      });
      logger.warn(
        {
          err: params.err,
          reason: failure.message,
          job_id: job.id,
          job_name: job.name,
          attempt: job.attempts,
          max_attempts: job.max_attempts,
          delay_ms: decision.delay_ms,
          duration_ms
        },
        'job attempt failed; retry scheduled'
      );
      return;
    }

    await this.repo.fail({
      ...lease,
      message: failure.message,
      errors: ctx.snapshotErrors(),
      progress,
      retention_sec: this.config.failed_retention_sec
    });
    this.failed_total++;
    logger.error(
      {
        err: params.err,
        reason: decision.reason,
        message: failure.message,
        job_id: job.id,
        job_name: job.name,
        attempt: job.attempts,
        duration_ms,
        ...progress
      },
      'job failed'
    );
  }

  private async deadLetterExhausted(job: Job): Promise<void> {
    await this.repo.fail({
      job_id: job.id,
      worker_id: this.config.worker_id,
      now: new Date(),
      message: `attempts exhausted (${job.attempts}/${job.max_attempts})`,
      retention_sec: this.config.failed_retention_sec
    });
    this.failed_total++;
    logger.error(
      { job_id: job.id, job_name: job.name, attempts: job.attempts, max_attempts: job.max_attempts },
      'job dead-lettered without running'
    );
  }

  private retryPolicyFor(job: Job): RetryPolicy {
    const handler = this.registry.get(job.name);
    return { ...this.config.default_retry_policy, ...(handler?.retry_policy ?? {}) };
  }

  private leaseMsFor(handler_lease_ms: number | undefined): number {
    return handler_lease_ms ?? this.config.lease_ms;
  }

  private countersOnly(): Omit<WorkerStats, 'worker_id' | 'in_flight'> {
    return {
      claimed_total: this.claimed_total,
      succeeded_total: this.succeeded_total,
      failed_total: this.failed_total
    };
  }

  private static asFailure(
    result: JobResult | undefined,
    err: unknown
  ): { message: string; explicit_retryable?: boolean } | null {
    if (err !== undefined) return { message: JobErrorPolicy.toMessage(err) };
    if (result?.outcome === 'failed') {
      return { message: result.reason, explicit_retryable: result.retryable };
    }
    return null;
  }
}
