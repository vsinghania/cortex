import express from 'express';
import cors from 'cors';
import { logger } from '../../common/logger.js';
import { RateLimitMiddleware } from '../../common/middlewares/rate_limit.js';
import { Time } from '../../lib/time.js';
import type { OAuthConfig } from '../../oauth_svc/config/oauth_config.js';
import { OAuthProtocolError } from '../../oauth_svc/oauth_errors.js';
import { OAuthAuthorizationServer, type OAuthParams } from '../../oauth_svc/oauth_authorization_server.js';

const AUTHORIZE_REQUESTS_PER_15_MIN = 100;
const TOKEN_REQUESTS_PER_MINUTE = 60;

/**
 * The OAuth authorization server's HTTP surface, mounted at the app root because RFC 8414
 * puts the metadata under `/.well-known`. It runs ahead of the app-wide CORS policy and
 * body parsers: MCP clients call it from any origin, with form-encoded bodies.
 */
export class OAuthServerController {
  private readonly router = express.Router();

  constructor(
    private readonly server: OAuthAuthorizationServer,
    private readonly config: OAuthConfig
  ) {
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    const any_origin = cors({ origin: '*' });
    const form = express.urlencoded({ extended: false, limit: '16kb' });

    this.router.options(OAuthAuthorizationServer.getMetadataEndpointPath(this.config), any_origin);
    this.router.get(OAuthAuthorizationServer.getMetadataEndpointPath(this.config), any_origin, this.serveAuthorizationServerMetadata.bind(this));

    this.router.all(
      OAuthAuthorizationServer.getOAuthEndpointPath(this.config, 'authorize'),
      OAuthServerController.createRequestRateLimiter(Time.minutesToMs(15), AUTHORIZE_REQUESTS_PER_15_MIN),
      form,
      this.handleAuthorizationRequest.bind(this)
    );

    const token_path = OAuthAuthorizationServer.getOAuthEndpointPath(this.config, 'token');
    this.router.options(token_path, any_origin);
    this.router.post(token_path, any_origin, OAuthServerController.createRequestRateLimiter(Time.minutesToMs(1), TOKEN_REQUESTS_PER_MINUTE), form, this.handleTokenExchange.bind(this));

    const revoke_path = OAuthAuthorizationServer.getOAuthEndpointPath(this.config, 'revoke');
    this.router.options(revoke_path, any_origin);
    this.router.post(revoke_path, any_origin, OAuthServerController.createRequestRateLimiter(Time.minutesToMs(1), TOKEN_REQUESTS_PER_MINUTE), form, this.handleTokenRevocation.bind(this));
  }

  private serveAuthorizationServerMetadata(_req: express.Request, res: express.Response) {
    res.json(this.server.getAuthorizationServerMetadata());
  }

  /**
   * A browser navigation. Errors about the request go back to the client's redirect_uri;
   * errors about the client or the redirect_uri itself are shown here, because sending a
   * browser to an unverified address is exactly what must not happen.
   */
  private async handleAuthorizationRequest(req: express.Request, res: express.Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).end();
      return;
    }
    try {
      res.redirect(302, await this.server.beginAuthorizationRequest(OAuthServerController.parseOAuthRequestParams(req.method === 'POST' ? req.body : req.query)));
    } catch (err) {
      const failure = OAuthServerController.toOAuthProtocolError(err, 'oauth authorize failed');
      res.status(failure.status).type('html').send(OAuthServerController.renderAuthorizationErrorPage(failure));
    }
  }

  private async handleTokenExchange(req: express.Request, res: express.Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    try {
      res.json(await this.server.exchangeTokenGrant(OAuthServerController.parseOAuthRequestParams(req.body)));
    } catch (err) {
      const failure = OAuthServerController.toOAuthProtocolError(err, 'oauth token request failed');
      res.status(failure.status).json(failure.toOAuthErrorResponse());
    }
  }

  private async handleTokenRevocation(req: express.Request, res: express.Response) {
    try {
      await this.server.revokeTokenFamilyForToken(OAuthServerController.parseOAuthRequestParams(req.body));
      res.status(200).end();
    } catch (err) {
      const failure = OAuthServerController.toOAuthProtocolError(err, 'oauth revoke failed');
      res.status(failure.status).json(failure.toOAuthErrorResponse());
    }
  }

  /** Only single string values: a repeated parameter is ambiguous, so it counts as absent. */
  private static parseOAuthRequestParams(source: unknown): OAuthParams {
    const out: OAuthParams = {};
    if (!source || typeof source !== 'object') return out;
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  }

  private static toOAuthProtocolError(err: unknown, log_message: string): OAuthProtocolError {
    if (err instanceof OAuthProtocolError) return err;
    logger.error({ err }, log_message);
    return new OAuthProtocolError('server_error', 'Something went wrong. Try again.', 500);
  }

  private static createRequestRateLimiter(window_ms: number, max: number): express.RequestHandler {
    return RateLimitMiddleware.createRateLimiter({ windowMs: window_ms, max, message: 'Too many requests, please try again later.' });
  }

  private static renderAuthorizationErrorPage(failure: OAuthProtocolError): string {
    const text = OAuthServerController.escapeHtml(failure.description);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cortex: can't connect</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">This app can't connect to Cortex</h1><p>${text}</p><p>Go back to the app you came from and try again, or contact its developer.</p></body></html>`;
  }

  private static escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
  }
}
