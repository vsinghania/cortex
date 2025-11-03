import express from 'express';
import { DbHealthUtils } from '../../db/mongo/health.js';
import { logger } from '../../common/logger.js';

export class HealthController {
  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    this.router.get('/db', this.dbHealth.bind(this));
  }

  private async dbHealth(req: express.Request, res: express.Response): Promise<void> {
    const host = typeof req.query.host === 'string' ? req.query.host : undefined;
    const port =
      typeof req.query.port === 'string' && !Number.isNaN(Number(req.query.port))
        ? Number(req.query.port)
        : undefined;

    const health = DbHealthUtils.getDbHealth({ host, port });
    const code = health.status === 'up' ? 200 : 503;

    const total = health.details.length;
    const connected = health.details.filter((d) => d.ready_state === 1).length;
    const targets = health.details.map((d) => `${d.host}:${d.port}=${d.state}`);

    logger.info({ msg: 'db health check', status: health.status, connected, total, targets });

    res.status(code).json(health);
  }
}
