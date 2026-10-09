import express from 'express';
import type { ClientRequest, ServerResponse } from 'node:http';
import { logger } from '../../common/logger.js';
import { RateLimitMiddleware } from '../../common/middlewares/rate_limit.js';
import { TraceContext } from '../../common/trace_context.js';
import { Time } from '../../lib/time.js';
import { BearerToken } from '../../lib/bearer_token.js';
import { McpCallerAssertion } from '../../mcp/server/mcp_caller_assertion.js';
import type { McpGatewayCaller } from '../../mcp/server/types/mcp_server.types.js';
import type { McpTokenVerifier, VerifiedMcpToken } from '../../mcp/resource/mcp_token_verifier.js';
import type { McpResource } from '../../mcp/resource/mcp_resource.types.js';
import { McpResourceCatalog } from '../../mcp/resource/mcp_resource_catalog.js';
import { ProtectedResourceMetadata } from '../../mcp/resource/protected_resource_metadata.js';
import { CanonicalUrl } from '../../lib/canonical_url.js';
import { McpProxyRouter } from './mcp_proxy_router.js';

export type PublicMcpGatewayOptions = {
  verifier: McpTokenVerifier;
  /** The one resource this gateway serves: its public URL, scopes, internal URL and audience. */
  resource: McpResource;
  /** The authorization server's issuer, advertised in the protected-resource metadata. */
  authorization_server_url: URL;
  /** Signs the per-request caller assertion only the MCP servers can verify. */
  assertion_secret: string;
};

type GatewayLocals = { caller: McpGatewayCaller; grant_id: string; trace_id?: string };

const LOCALS_KEY = 'mcp_gateway';
/** Everything the internal server could read identity or tracing from; none may come from the caller. */
const STRIPPED_HEADERS = ['authorization', 'x-user-id', 'x-mcp-scopes', 'x-mcp-client-id', 'x-trace-id', 'cookie'];
const REQUESTS_PER_GRANT_PER_MINUTE = 120;

/**
 * The MCP resource server for one public MCP server (`/notes`, later `/articles`, …) and
 * its RFC 9728 metadata. It accepts only access tokens its authorization server issued
 * for this exact resource, and turns each into a caller assertion addressed to this
 * resource's MCP server, so that server never has to trust anything a caller can set.
 */
export class PublicMcpGateway {
  private readonly resource: string;
  private readonly metadata_url: string;

  private constructor(private readonly opts: PublicMcpGatewayOptions) {
    this.resource = opts.resource.url;
    this.metadata_url = ProtectedResourceMetadata.getProtectedResourceMetadataUrl(new URL(opts.resource.url));
  }

  /** Mounted at the host root: the metadata path lives under `/.well-known`, not under the resource. */
  static buildRouter(opts: PublicMcpGatewayOptions): express.Router {
    const gateway = new PublicMcpGateway(opts);
    const router = express.Router();
    router.get(new URL(gateway.metadata_url).pathname, gateway.serveProtectedResourceMetadata.bind(gateway));
    router.use(
      new URL(opts.resource.url).pathname,
      gateway.authenticateAccessToken.bind(gateway),
      PublicMcpGateway.createGrantRateLimiter(opts.resource.id),
      McpProxyRouter.buildRouter({
        name: `${opts.resource.id}-public`,
        target_url: opts.resource.internal_url,
        rewriteRequestHeaders: (proxy_req, res) => gateway.rewriteUpstreamAuthHeaders(proxy_req, res)
      })
    );
    return router;
  }

  // Readable from any origin: browser-based MCP clients fetch it before they hold a token.
  private serveProtectedResourceMetadata(_req: express.Request, res: express.Response): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(
      ProtectedResourceMetadata.buildProtectedResourceMetadata({
        resource: this.resource,
        authorization_server: CanonicalUrl.of(this.opts.authorization_server_url),
        scopes: McpResourceCatalog.listResourceScopes(this.opts.resource),
        resource_name: `Cortex ${this.opts.resource.display_name.toLowerCase()}`
      })
    );
  }

  private async authenticateAccessToken(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
    const token = BearerToken.parseAuthorizationHeader(req.headers.authorization);
    if (!token) {
      this.sendBearerTokenChallenge(res, null);
      return;
    }

    let verified: VerifiedMcpToken | null;
    try {
      verified = await this.opts.verifier.verifyAccessToken(token);
    } catch (err) {
      logger.error({ err }, 'public MCP token verification failed');
      res.status(503).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Authorization temporarily unavailable' }, id: null });
      return;
    }

    if (!verified) {
      this.sendBearerTokenChallenge(res, { error: 'invalid_token', description: 'The access token is invalid, expired or revoked' });
      return;
    }
    // RFC 8707: a token issued for another resource must never be spent here.
    if (verified.resource !== this.resource) {
      logger.warn({ client_id: verified.client_id, grant_id: verified.grant_id }, 'public MCP token for another resource refused');
      this.sendBearerTokenChallenge(res, { error: 'invalid_token', description: 'The access token was not issued for this resource' });
      return;
    }

    TraceContext.setUserId(verified.user_id);
    const locals: GatewayLocals = {
      caller: {
        kind: verified.kind,
        user_id: verified.user_id,
        client_id: verified.client_id,
        scopes: new Set(verified.scopes)
      },
      grant_id: verified.grant_id,
      trace_id: TraceContext.getTraceId()
    };
    res.locals[LOCALS_KEY] = locals;
    next();
  }

  private rewriteUpstreamAuthHeaders(proxy_req: ClientRequest, res: ServerResponse): void {
    for (const header of STRIPPED_HEADERS) proxy_req.removeHeader(header);
    const locals = (res as express.Response).locals?.[LOCALS_KEY] as GatewayLocals | undefined;
    if (!locals) return;

    const assertion = McpCallerAssertion.signGatewayCallerAssertion({
      secret: this.opts.assertion_secret,
      audience: this.opts.resource.assertion_audience,
      caller: locals.caller
    });
    proxy_req.setHeader('authorization', `Bearer ${assertion}`);
    if (locals.trace_id) proxy_req.setHeader('x-trace-id', locals.trace_id);
  }

  /**
   * RFC 9728 §5.1 and MCP scope selection: the 401 names the metadata (how a client
   * holding only the MCP URL finds the authorization server) and the scopes to ask for.
   */
  private sendBearerTokenChallenge(res: express.Response, failure: { error: string; description: string } | null): void {
    const params = [
      ...(failure ? [`error="${failure.error}"`, `error_description="${failure.description}"`] : []),
      `resource_metadata="${this.metadata_url}"`,
      `scope="${McpResourceCatalog.listResourceScopes(this.opts.resource).join(' ')}"`
    ];
    res.setHeader('WWW-Authenticate', `Bearer ${params.join(', ')}`);
    res.status(401).json(failure ? { error: failure.error, error_description: failure.description } : { error: 'unauthorized' });
  }

  private static createGrantRateLimiter(resource_id: string): express.RequestHandler {
    return RateLimitMiddleware.createRateLimiter({
      windowMs: Time.minutesToMs(1),
      max: REQUESTS_PER_GRANT_PER_MINUTE,
      message: 'Too many MCP requests, please slow down.',
      keyGenerator: (_req, res) => `${resource_id}:grant:${(res.locals[LOCALS_KEY] as GatewayLocals).grant_id}`
    });
  }
}
