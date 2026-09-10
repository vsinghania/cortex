import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { JobScheduler } from '../../jobs_svc/job_scheduler.js';
import { NotFoundError } from '../../common/errors.js';

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
    catchup: z.boolean().optional(),
    max_attempts: z.number().int().positive().max(50).optional()
  })
  .strict();

const ScheduleParamsSchema = z.object({ id: z.string().min(1) });
const EnabledBodySchema = z.object({ enabled: z.boolean() }).strict();

type ScheduleBody = z.infer<typeof ScheduleBodySchema>;

/**
 * Recurring schedule management, mounted under /api/v1/admin/jobs.
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
    this.router.put('/schedules', this.upsertSchedule.bind(this));
    this.router.get('/schedules', this.listSchedules.bind(this));
    this.router.get('/schedules/:id', this.getSchedule.bind(this));
    this.router.patch('/schedules/:id', this.setEnabled.bind(this));
    this.router.delete('/schedules/:id', this.deleteSchedule.bind(this));
  }

  /**
   * PUT rather than POST: creation is an upsert on a caller-supplied id, which is
   * idempotent, so re-sending the same body is not a second schedule.
   *
   * Rejects an unregistered job name or a payload the handler's own schema
   * refuses - failing here beats failing at 03:00.
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
  private async setEnabled(req: express.Request, res: express.Response, next: express.NextFunction) {
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
}
