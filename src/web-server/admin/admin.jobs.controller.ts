import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { JobsSvc } from '../../jobs_svc/jobs_svc.js';
import { JobScheduler } from '../../jobs_svc/job_scheduler.js';
import { JobHandlerRegistry } from '../../jobs_svc/handlers/job_handler_registry.js';
import { JobStatus } from '../../jobs_svc/types/job.types.js';
import { BadRequestError, NotFoundError } from '../../common/errors.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

const numericQuery = (max: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .pipe(z.number().int().positive().max(max))
    .optional();

// --- concrete runs ---------------------------------------------------------

const JobListQuerySchema = z.object({
  name: z.string().min(1).optional(),
  status: z.nativeEnum(JobStatus).optional(),
  user_id: z.string().min(1).optional(),
  limit: numericQuery(MAX_LIST_LIMIT)
});

const JobStatsQuerySchema = z.object({ name: z.string().min(1).optional() });

const EnqueueBodySchema = z
  .object({
    name: z.string().min(1),
    payload: z.record(z.unknown()).default({}),
    user_id: z.string().min(1).optional(),
    dedup_key: z.string().min(1).optional(),
    delay_ms: z.number().int().nonnegative().optional(),
    max_attempts: z.number().int().positive().max(50).optional()
  })
  .strict();

const JobParamsSchema = z.object({ job_id: z.string().min(1) });

// --- recurring definitions -------------------------------------------------

const ScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), every_ms: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal('cron'),
      expression: z.string().min(1),
      // IANA name; validated for real by cron-parser via ScheduleClock.
      timezone: z.string().min(1).optional()
    })
    .strict()
]);

const ScheduleBodySchema = z
  .object({
    id: z.string().min(1).max(120),
    name: z.string().min(1),
    payload: z.record(z.unknown()).default({}),
    schedule: ScheduleSchema,
    label: z.string().min(1).max(200).optional(),
    dedup_key: z.string().min(1).optional(),
    user_id: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    // Absent = no deadline. Becomes deadline_at on every spawned run.
    max_delay_ms: z.number().int().positive().optional(),
    max_attempts: z.number().int().positive().max(50).optional()
  })
  .strict();

const ScheduleParamsSchema = z.object({ id: z.string().min(1) });
const EnabledBodySchema = z.object({ enabled: z.boolean() }).strict();

type EnqueueBody = z.infer<typeof EnqueueBodySchema>;
type ScheduleBody = z.infer<typeof ScheduleBodySchema>;

/**
 * Background jobs, mounted under /api/v1/admin/jobs: concrete runs at the root,
 * recurring definitions under /schedules.
 *
 * The notes routes under /admin/notes/reindex remain the notes-specific surface -
 * they carry their own body schema and 404 on a job of any other name, which is a
 * safety property worth keeping rather than folding in here.
 *
 * Carries no auth of its own: AdminController gates the whole tree once.
 */
export class AdminJobsController {

  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    // Order matters: the literal paths must come before '/:job_id', or
    // '/schedules' and '/stats' would be read as job ids.
    this.router.put('/schedules', this.upsertSchedule.bind(this));
    this.router.get('/schedules', this.listSchedules.bind(this));
    this.router.get('/schedules/:id', this.getSchedule.bind(this));
    this.router.patch('/schedules/:id', this.setScheduleEnabled.bind(this));
    this.router.delete('/schedules/:id', this.deleteSchedule.bind(this));

    this.router.get('/stats', this.getStats.bind(this));

    this.router.post('/', this.enqueueJob.bind(this));
    this.router.get('/', this.listJobs.bind(this));
    this.router.get('/:job_id', this.getJob.bind(this));
    this.router.post('/:job_id/cancel', this.cancelJob.bind(this));
  }

  // --- concrete runs -------------------------------------------------------

  /**
   * Runs a job now, out of band - the "trigger it without waiting for 03:00"
   * companion to a schedule. Validated the same way a schedule is, so an
   * unregistered name or a payload the handler refuses is a 400 here rather than
   * a job no worker can run.
   */
  @validateRequest({ body: EnqueueBodySchema })
  private async enqueueJob(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const body = req.body as EnqueueBody;
      AdminJobsController.assertRunnable(body.name, body.payload ?? {});

      const jobs_svc = await JobsSvc.getInstance();
      const { job_id } = await jobs_svc.enqueue({
        ...body,
        payload: body.payload ?? {},
        requested_by: req.auth!.user_id
      });

      const job = await jobs_svc.getJob(job_id);
      // 202: the work happens on a worker, not in this request.
      res.status(202).json({ response: { job } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ query: JobListQuerySchema })
  private async listJobs(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const q = req.query as Record<string, string | undefined>;
      const jobs_svc = await JobsSvc.getInstance();

      const jobs = await jobs_svc.listJobs({
        name: q.name,
        status: q.status as JobStatus | undefined,
        user_id: q.user_id,
        limit: q.limit ? Number(q.limit) : DEFAULT_LIST_LIMIT
      });
      res.status(200).json({ response: { jobs } });
    } catch (e) {
      next(e);
    }
  }

  /** Queue depth by status - the counterpart to a name with no registered handler. */
  @validateRequest({ query: JobStatsQuerySchema })
  private async getStats(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const q = req.query as Record<string, string | undefined>;
      const jobs_svc = await JobsSvc.getInstance();

      const counts = await jobs_svc.getStats({ name: q.name });
      res.status(200).json({
        response: {
          counts,
          // Queued rows under a name nothing handles are claimed and released on
          // a loop, so surfacing what IS handled makes that diagnosable.
          registered_names: JobHandlerRegistry.getInstance().registeredNames()
        }
      });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: JobParamsSchema })
  private async getJob(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { job_id } = req.params as { job_id: string };
      const jobs_svc = await JobsSvc.getInstance();
      const job = await jobs_svc.getJob(job_id);
      if (!job) throw new NotFoundError('Job not found');
      res.status(200).json({ response: { job } });
    } catch (e) {
      next(e);
    }
  }

  /**
   * A queued job cancels outright; a running one is flagged and its worker
   * notices on the next heartbeat, so this returns before the job has stopped.
   */
  @validateRequest({ params: JobParamsSchema })
  private async cancelJob(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { job_id } = req.params as { job_id: string };
      const jobs_svc = await JobsSvc.getInstance();

      const existing = await jobs_svc.getJob(job_id);
      if (!existing) throw new NotFoundError('Job not found');

      const job = await jobs_svc.requestCancel(job_id);
      res.status(202).json({ response: { job: job ?? existing } });
    } catch (e) {
      next(e);
    }
  }

  // --- recurring definitions -----------------------------------------------

  /**
   * PUT rather than POST: creation is an upsert on a caller-supplied id, which is
   * idempotent, so re-sending the same body is not a second schedule.
   */
  @validateRequest({ body: ScheduleBodySchema })
  private async upsertSchedule(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const body = req.body as ScheduleBody;
      const scheduler = await JobScheduler.create();

      const existing = await scheduler.getSchedule(body.id);
      const schedule = await scheduler.upsertSchedule({
        ...body,
        payload: body.payload ?? {},
        created_by: req.auth!.user_id
      });

      res.status(existing ? 200 : 201).json({ response: { schedule } });
    } catch (e) {
      next(e);
    }
  }

  private async listSchedules(_req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const scheduler = await JobScheduler.create();
      const schedules = await scheduler.listSchedules();
      res.status(200).json({ response: { schedules } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: ScheduleParamsSchema })
  private async getSchedule(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { id } = req.params as { id: string };
      const scheduler = await JobScheduler.create();
      const schedule = await scheduler.getSchedule(id);
      if (!schedule) throw new NotFoundError('Job schedule not found');
      res.status(200).json({ response: { schedule } });
    } catch (e) {
      next(e);
    }
  }

  /**
   * Disabling is the reversible alternative to deleting, and it survives a
   * redeploy - the boot seed only sets `enabled` on insert.
   */
  @validateRequest({ params: ScheduleParamsSchema, body: EnabledBodySchema })
  private async setScheduleEnabled(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { id } = req.params as { id: string };
      const { enabled } = req.body as { enabled: boolean };
      const scheduler = await JobScheduler.create();

      const schedule = await scheduler.setScheduleEnabled({ id, enabled });
      if (!schedule) throw new NotFoundError('Job schedule not found');
      res.status(200).json({ response: { schedule } });
    } catch (e) {
      next(e);
    }
  }

  /**
   * Removes the definition only. Jobs it already spawned are independent rows and
   * keep running - cancel those through the job routes if that is not wanted.
   *
   * A schedule seeded at boot will be recreated by the next deploy; disable it
   * instead if the intent is to stop it for good.
   */
  @validateRequest({ params: ScheduleParamsSchema })
  private async deleteSchedule(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { id } = req.params as { id: string };
      const scheduler = await JobScheduler.create();
      if (!(await scheduler.deleteSchedule(id))) throw new NotFoundError('Job schedule not found');
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  }

  /**
   * Refuses work that could only fail later: an unregistered name spawns jobs no
   * worker can run (claimed and released on a loop rather than failing visibly),
   * and a payload the handler's own schema rejects would fail on the worker
   * rather than at the request that created it.
   */
  private static assertRunnable(name: string, payload: Record<string, unknown>): void {
    const registry = JobHandlerRegistry.getInstance();
    const handler = registry.get(name);
    if (!handler) {
      throw new BadRequestError(
        `Unknown job name: ${name}. Registered: ${registry.registeredNames().join(', ') || '(none)'}`
      );
    }
    try {
      handler.parsePayload(payload);
    } catch (err) {
      throw new BadRequestError(`Payload is invalid for job ${name}`, { cause: err });
    }
  }
}
