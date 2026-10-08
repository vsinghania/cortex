import express from 'express';
import { Time } from '../../lib/time.js';
import { CortexIcons } from '../../mcp/brand/cortex_icons.js';

const FAVICON_MAX_AGE_SEC = Time.daysToSec(1);

/**
 * `/favicon.ico` on every host web-server answers for. Assistants that show a connector's
 * site icon fetch it from the connector's host, mcp.cortexapp.me, which has no SPA behind it.
 */
export class FaviconController {
  private readonly router = express.Router();
  private readonly icon = CortexIcons.faviconIco();

  constructor() {
    this.router.get('/favicon.ico', this.serve.bind(this));
  }

  getRouter() {
    return this.router;
  }

  private serve(_req: express.Request, res: express.Response) {
    res.set({
      'Cache-Control': `public, max-age=${FAVICON_MAX_AGE_SEC}`,
      // Rendered by other sites' pages (an assistant's connector list), so it must not be same-origin only.
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });
    res.type('image/x-icon').send(this.icon);
  }
}
