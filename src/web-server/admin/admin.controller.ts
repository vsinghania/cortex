import express from 'express';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { AuthorizeMiddleware } from '../../common/middlewares/authorize.js';
import { AdminNotesController } from './admin.notes.controller.js';
import { AdminJobsController } from './admin.jobs.controller.js';
import { AdminUsersController } from './admin.users.controller.js';
import { logger } from '../../common/logger.js';

/**
 * Parent router for /api/v1/admin. Holds no routes of its own: it applies the
 * admin gate once and mounts one sub-controller per area (notes, and later users,
 * agents, ...).
 *
 * Gating here rather than per route is the point of the split - a new admin area
 * inherits requireAuth + authorizeRoles('admin') by being mounted, so it cannot
 * ship unprotected by forgetting a line. Sub-controllers must NOT re-apply it;
 * duplicating the gate invites the belief that they are safe standalone.
 */
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
    this.router.use(RequireAuthMiddleware.requireAuth);
    this.router.use(AuthorizeMiddleware.authorizeRoles('admin'));

    this.router.use('/notes', new AdminNotesController().getRouter());
    this.router.use('/jobs', new AdminJobsController().getRouter());
    this.router.use('/users', new AdminUsersController().getRouter());

    logger.info({ mounts: ['notes', 'jobs', 'users'] }, 'admin routes mounted');
  }
}
