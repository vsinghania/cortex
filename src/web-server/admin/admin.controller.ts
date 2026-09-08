import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { AuthorizeMiddleware } from '../../common/middlewares/authorize.js';
import { JobsSvc } from '../../jobs_svc/jobs_svc.js';
import { JobDedupKey } from '../../jobs_svc/job_dedup_key.js';
import {
  MAX_REINDEX_NOTE_IDS,
  MAX_REINDEX_USER_IDS,
  NotesJobName
} from '../../notes_svc/jobs/notes_job.types.js';
import { NotFoundError } from '../../common/errors.js';

const ReindexBodySchema = z
  .object({
    mode: z.enum(['rechunk', 'reembed']),
    user_ids: z.array(z.string().min(1)).min(1).max(MAX_REINDEX_USER_IDS).optional(),
    note_ids: z.array(z.string().min(1)).min(1).max(MAX_REINDEX_NOTE_IDS).optional(),
    dry_run: z.boolean().optional()
  })
  .strict();

const JobParamsSchema = z.object({ job_id: z.string().min(1) });

type ReindexBody = z.infer<typeof ReindexBodySchema>;

export class AdminController {

  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    // Gated at the router level rather than per route: every route here is
    // admin-only, so gating once is both simpler and safer against a future route
    // being added without it.
    this.router.use(RequireAuthMiddleware.requireAuth);
    this.router.use(AuthorizeMiddleware.authorizeRoles('admin'));

    this.router.post('/notes/reindex', this.startReindex.bind(this));
    this.router.get('/notes/reindex', this.listReindexJobs.bind(this));
    this.router.get('/notes/reindex/:job_id', this.getReindexJob.bind(this));
    this.router.post('/notes/reindex/:job_id/cancel', this.cancelReindexJob.bind(this));
  }

  @validateRequest({ body: ReindexBodySchema })
  private async startReindex(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const body = req.body as ReindexBody;
      const jobs_svc = await JobsSvc.getInstance();

      const { job_id } = await jobs_svc.enqueue({
        name: NotesJobName.NotesReindex,
        payload: {
          mode: body.mode,
          user_ids: body.user_ids,
          note_ids: body.note_ids,
          dry_run: body.dry_run ?? false
        },
        // Scopes the single-flight lock, so re-indexing one user does not 409
        // against an unrelated user's run. Set ONLY for a single-user selection;
        // a multi-user or unfiltered sweep stays system-wide and shares the key.
        user_id: body.user_ids?.length === 1 ? body.user_ids[0] : undefined,
        dedup_key: JobDedupKey.build([NotesJobName.NotesReindex]),
        requested_by: req.auth!.user_id
      });

      const job = await jobs_svc.getJob(job_id);
      // 202, not 200: the ALB idle timeout is 60s, so the request cannot block on
      // a sweep that may run for hours.
      res.status(202).json({ response: { job } });
    } catch (e) {
      next(e);
    }
  }

  private async listReindexJobs(_req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const jobs_svc = await JobsSvc.getInstance();
      const jobs = await jobs_svc.listJobs({ name: NotesJobName.NotesReindex, limit: 20 });
      res.status(200).json({ response: { jobs } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: JobParamsSchema })
  private async getReindexJob(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { job_id } = req.params as { job_id: string };
      const jobs_svc = await JobsSvc.getInstance();
      const job = await jobs_svc.getJob(job_id);
      if (!job || job.name !== NotesJobName.NotesReindex) throw new NotFoundError('Job not found');
      res.status(200).json({ response: { job } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: JobParamsSchema })
  private async cancelReindexJob(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { job_id } = req.params as { job_id: string };
      const jobs_svc = await JobsSvc.getInstance();

      const existing = await jobs_svc.getJob(job_id);
      if (!existing || existing.name !== NotesJobName.NotesReindex) throw new NotFoundError('Job not found');

      // A queued job cancels outright; a running one is flagged and its worker
      // notices on the next heartbeat, so this returns before the job has stopped.
      const job = await jobs_svc.requestCancel(job_id);
      res.status(202).json({ response: { job: job ?? existing } });
    } catch (e) {
      next(e);
    }
  }
}
