import express from 'express';
import type { ClientRequest, ServerResponse } from 'node:http';
import { logger } from '../../common/logger.js';
import { RateLimitMiddleware } from '../../common/middlewares/rate_limit.js';
import { TraceContext } from '../../common/trace_context.js';
import { Time } from '../../lib/time.js';
import { McpCallerAssertion } from '../../mcp/server/mcp_caller_assertion.js';
import type { McpGatewayCaller } from '../../mcp/server/types/mcp_server.types.js';
import type { McpTokenVerifier, VerifiedMcpToken } from '../../mcp/resource/mcp_token_verifier.js';
import { ProtectedResourceMetadata } from '../../mcp/resource/protected_resource_metadata.js';
import { McpProxyRouter } from './mcp_proxy_router.js';

export type PublicMcpGatewayOptions = {
  verifier: McpTokenVerifier;
  /** The canonical `/mcp` URL: what tokens must be issued for, and what the metadata names. */
  mcp_resource_url: URL;
  /** The authorization server's issuer, advertised in the protected-resource metadata. */
  authorization_server_url: URL;
  scopes: readonly string[];
  internal_url: string;
  /** Signs the per-request caller assertion only the notes MCP server can verify. */
  assertion_secret: string;
};

type GatewayLocals = { caller: McpGatewayCaller; grant_id: string; trace_id?: string };

const LOCALS_KEY = 'mcp_gateway';
/** Everything the internal server could read identity or tracing from; none may come from the caller. */
const STRIPPED_HEADERS = ['authorization', 'x-user-id', 'x-mcp-scopes', 'x-mcp-client-id', 'x-trace-id', 'cookie'];
const REQUESTS_PER_GRANT_PER_MINUTE = 120;

/**
 * The MCP resource server: `/mcp` and its RFC 9728 metadata, for ChatGPT, Claude and
 * voice. It accepts only access tokens its authorization server issued for this exact
 * resource, and turns each into a signed caller assertion for the notes MCP server, so
 * that server never has to trust anything a caller can set.
 */
export class PublicMcpGateway {
  private readonly resource: string;
  private readonly metadata_url: string;

  private constructor(private readonly opts: PublicMcpGatewayOptions) {
    this.resource = PublicMcpGateway.canonical(opts.mcp_resource_url);
    this.metadata_url = ProtectedResourceMetadata.urlFor(opts.mcp_resource_url);
  }

  /** Mounted at the app root: the metadata path lives under `/.well-known`, not under `/mcp`. */
  static build(opts: PublicMcpGatewayOptions): express.Router {
    const gateway = new PublicMcpGateway(opts);
    const router = express.Router();
    router.get(new URL(gateway.metadata_url).pathname, gateway.serveMetadata.bind(gateway));
    router.use(
      PublicMcpGateway.mountPath(opts.mcp_resource_url),
      gateway.authenticate.bind(gateway),
      PublicMcpGateway.perGrantRateLimiter(),
      McpProxyRouter.build({
        name: 'notes-public',
        target_url: opts.internal_url,
        rewriteRequestHeaders: (proxy_req, res) => gateway.rewriteHeaders(proxy_req, res)
      })
    );
    return router;
  }

  // Readable from any origin: browser-based MCP clients fetch it before they hold a token.
  private serveMetadata(_req: express.Request, res: express.Response): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(
      ProtectedResourceMetadata.build({
        resource: this.resource,
        authorization_server: PublicMcpGateway.canonical(this.opts.authorization_server_url),
        scopes: this.opts.scopes,
        resource_name: 'Cortex notes'
      })
    );
  }

  private async authenticate(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
    const token = PublicMcpGateway.bearerToken(req);
    if (!token) {
      this.challenge(res, null);
      return;
    }

    let verified: VerifiedMcpToken | null;
    try {
      verified = await this.opts.verifier.verify(token);
    } catch (err) {
      logger.error({ err }, 'public MCP token verification failed');
      res.status(503).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Authorization temporarily unavailable' }, id: null });
      return;
    }

    if (!verified) {
      this.challenge(res, { error: 'invalid_token', description: 'The access token is invalid, expired or revoked' });
      return;
    }
    // RFC 8707: a token issued for another resource must never be spent here.
    if (verified.resource !== this.resource) {
      logger.warn({ client_id: verified.client_id, grant_id: verified.grant_id }, 'public MCP token for another resource refused');
      this.challenge(res, { error: 'invalid_token', description: 'The access token was not issued for this resource' });
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

  private rewriteHeaders(proxy_req: ClientRequest, res: ServerResponse): void {
    for (const header of STRIPPED_HEADERS) proxy_req.removeHeader(header);
    const locals = (res as express.Response).locals?.[LOCALS_KEY] as GatewayLocals | undefined;
    if (!locals) return;

    proxy_req.setHeader('authorization', `Bearer ${McpCallerAssertion.sign({ secret: this.opts.assertion_secret, caller: locals.caller })}`);
    if (locals.trace_id) proxy_req.setHeader('x-trace-id', locals.trace_id);
  }

  /**
   * RFC 9728 §5.1 and MCP scope selection: the 401 names the metadata (how a client
   * holding only the MCP URL finds the authorization server) and the scopes to ask for.
   */
  private challenge(res: express.Response, failure: { error: string; description: string } | null): void {
    const params = [
      ...(failure ? [`error="${failure.error}"`, `error_description="${failure.description}"`] : []),
      `resource_metadata="${this.metadata_url}"`,
      `scope="${this.opts.scopes.join(' ')}"`
    ];
    res.setHeader('WWW-Authenticate', `Bearer ${params.join(', ')}`);
    res.status(401).json(failure ? { error: failure.error, error_description: failure.description } : { error: 'unauthorized' });
  }

  private static perGrantRateLimiter(): express.RequestHandler {
    return RateLimitMiddleware.createRateLimiter({
      windowMs: Time.minutesToMs(1),
      max: REQUESTS_PER_GRANT_PER_MINUTE,
      message: 'Too many MCP requests, please slow down.',
      keyGenerator: (_req, res) => `grant:${(res.locals[LOCALS_KEY] as GatewayLocals).grant_id}`
    });
  }

  private static bearerToken(req: express.Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return /^Bearer$/i.test(scheme ?? '') && token ? token : null;
  }

  private static mountPath(resource: URL): string {
    return resource.pathname.replace(/\/+$/, '') || '/mcp';
  }

  /** Trailing slashes and fragments do not change which resource is meant. */
  static canonical(url: URL): string {
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  }
}
