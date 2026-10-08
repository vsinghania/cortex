import express from 'express';
import { z } from 'zod';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { ServiceUnavailableError } from '../../common/errors.js';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { OAuthSvc } from '../../oauth_svc/oauth_svc.js';
import type { McpAccess } from '../../mcp/resource/mcp_resource.types.js';

const RequestParamsSchema = z.object({ request_id: z.string().min(1).max(64) });
const GrantParamsSchema = z.object({ grant_id: z.string().min(1).max(64) });
const ApproveBodySchema = z.object({ access: z.enum(['read', 'read_write']) }).strict();

/**
 * The SPA side of connecting ChatGPT, Claude and other MCP clients: the consent page
 * reads and answers a parked authorization request, and Settings lists and revokes
 * connections. The protocol endpoints (/authorize, /token, ...) are OAuthServerController's.
 */
export class OAuthController {
  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    this.router.get('/requests/:request_id', RequireAuthMiddleware.requireAuth, this.describeRequest.bind(this));
    this.router.post('/requests/:request_id/approve', RequireAuthMiddleware.requireAuth, this.approve.bind(this));
    this.router.post('/requests/:request_id/deny', RequireAuthMiddleware.requireAuth, this.deny.bind(this));
    this.router.get('/grants', RequireAuthMiddleware.requireAuth, this.listGrants.bind(this));
    this.router.delete('/grants/:grant_id', RequireAuthMiddleware.requireAuth, this.revokeGrant.bind(this));
  }

  @validateRequest({ params: RequestParamsSchema })
  private async describeRequest(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const oauth_svc = await OAuthController.requireSvc();
      const request = await oauth_svc.describeRequest(String(req.params.request_id));
      res.status(200).json({ response: { request } });
    } catch (e) {
      next(e);
    }
  }

  /**
   * Answers with the URL rather than redirecting: this is an XHR carrying the bearer
   * token, and the SPA navigates to the client's redirect_uri itself.
   */
  @validateRequest({ params: RequestParamsSchema, body: ApproveBodySchema })
  private async approve(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const oauth_svc = await OAuthController.requireSvc();
      const { access } = req.body as { access: McpAccess };
      const result = await oauth_svc.approve({
        request_id: String(req.params.request_id),
        user_id: req.auth!.user_id,
        access
      });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: RequestParamsSchema })
  private async deny(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const oauth_svc = await OAuthController.requireSvc();
      const result = await oauth_svc.deny({ request_id: String(req.params.request_id), user_id: req.auth!.user_id });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  /** Answers even when unconfigured, so Settings can hide the card instead of erroring. */
  private async listGrants(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      if (!OAuthSvc.isConfigured()) {
        res.status(200).json({ response: { available: false, resources: [], grants: [] } });
        return;
      }
      const oauth_svc = await OAuthSvc.create();
      const grants = await oauth_svc.listGrants(req.auth!.user_id);
      res.status(200).json({ response: { available: true, resources: oauth_svc.listResources(), grants } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: GrantParamsSchema })
  private async revokeGrant(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const oauth_svc = await OAuthController.requireSvc();
      await oauth_svc.revokeGrant({ user_id: req.auth!.user_id, grant_id: String(req.params.grant_id) });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  }

  private static async requireSvc(): Promise<OAuthSvc> {
    if (!OAuthSvc.isConfigured()) {
      throw new ServiceUnavailableError('Connecting external assistants is not configured');
    }
    return OAuthSvc.create();
  }
}
