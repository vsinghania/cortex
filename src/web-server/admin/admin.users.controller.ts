import express from 'express';
import { z } from 'zod';
import { ValidationMiddleware } from '../../common/middlewares/validate.js';
import { AdminUsersSvc } from '../../admin_svc/admin_users_svc.js';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

const ListUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0)
});

type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

/**
 * Users overview, mounted under /api/v1/admin/users.
 *
 * Carries no auth of its own: AdminController gates the whole tree once, so every
 * route here is already behind requireAuth + authorizeRoles('admin').
 */
export class AdminUsersController {

  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    // The validate middleware, not @validateRequest, because the query needs Zod's coercion and defaults.
    this.router.get('/', ValidationMiddleware.validate({ query: ListUsersQuerySchema }), this.listUsers.bind(this));
  }

  private async listUsers(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const query = req.validated!.query as ListUsersQuery;
      const admin_users_svc = await AdminUsersSvc.create();
      const page = await admin_users_svc.listUsers(query);
      res.status(200).json({ response: page });
    } catch (e) {
      next(e);
    }
  }
}
