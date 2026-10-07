import express from 'express';
import cors from 'cors';
import { ErrorHandlerMiddleware } from '../common/middlewares/error_handler.js'
import { TraceContextMiddleware } from '../common/middlewares/trace_context_middleware.js';
import { HttpLoggerMiddleware } from '../common/middlewares/http_logger_middleware.js';
import { logger } from '../common/logger.js';
import { AiController } from './ai/ai.controller.js';
import { HealthController } from './health/health.controller.js';
import cookieParser from 'cookie-parser';
import { AuthController } from './auth/auth.controller.js';
import { AgentController } from './agent/agent.controller.js';
import { NotesController } from './notes/notes.controller.js';
import { VoiceController } from './voice/voice.controller.js';
import { AdminController } from './admin/admin.controller.js';
import { OneNoteController } from './integrations/onenote.controller.js';
import { McpProxyRouter } from './mcp/mcp_proxy_router.js';
import { PublicMcpGateway } from './mcp/public_mcp_gateway.js';
import { OAuthConfigLoader, type OAuthConfig } from '../oauth_svc/config/oauth_config.js';
import { OAuthAccessTokenVerifier } from '../oauth_svc/oauth_access_token_verifier.js';
import { NotesScope } from '../mcp/server/notes/notes_scope.js';

export class App {

  private app: express.Express = express();

  constructor() {}

  initApp() {
    const trusted_proxy_hops = this.configureProxyTrust();

    this.app.use(TraceContextMiddleware.establish);
    this.app.use(HttpLoggerMiddleware.build(logger));

    this.app.get('/healthz', (_req, res) => res.send('ok'));

    // Ahead of the app-wide CORS policy: MCP clients read the resource metadata from any
    // origin, and those routes set their own permissive CORS.
    this.registerPublicMcp();

    // Enable CORS with credentials for refresh cookies
    const origins = process.env.CORS_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean);
    this.app.use(cors({
      origin: origins && origins.length ? origins : true,
      credentials: true,
      exposedHeaders: [TraceContextMiddleware.trace_id_header],
    }));

    // MCP proxy routes are registered BEFORE express.json() so the request
    // body remains a raw stream that can be piped to upstream MCP servers.
    this.registerMcpProxyRoutes();

    this.app.use(express.json());
    this.app.use(cookieParser());

    this.registerRoutes();

    this.app.use(ErrorHandlerMiddleware.notFoundHandler);
    this.app.use(ErrorHandlerMiddleware.errorHandler);

    logger.info({ cors_origins: origins ?? 'any', trusted_proxy_hops }, 'Express app initialized');
    return;
  }

  // Behind a load balancer the real client IP only exists in X-Forwarded-For.
  // Without a hop count Express reports the balancer's address as req.ip for
  // every request, collapsing the per-IP auth rate limiter into one shared
  // bucket. A count rather than `true` keeps the header unspoofable.
  private configureProxyTrust(): number {
    const configured_hops = Number(process.env.TRUST_PROXY_HOPS);
    const trusted_hops = Number.isInteger(configured_hops) && configured_hops >= 0 ? configured_hops : 0;
    this.app.set('trust proxy', trusted_hops);
    return trusted_hops;
  }

  private registerMcpProxyRoutes() {
    const notes_target = process.env.MCP_NOTES_INTERNAL_URL;
    if (!notes_target) {
      logger.warn('MCP_NOTES_INTERNAL_URL not set; /api/v1/mcp/notes proxy is disabled');
      return;
    }

    this.app.use('/api/v1/mcp/notes', McpProxyRouter.build({ name: 'notes', target_url: notes_target }));
    logger.info({ mounts: ['/api/v1/mcp/notes'], notes_target }, 'MCP proxy routes mounted');
  }

  private registerPublicMcp() {
    const config = OAuthConfigLoader.fromEnv();
    if (!config) {
      logger.warn('OAUTH_ISSUER_URL or MCP_PUBLIC_URL not set; the public /mcp resource server is disabled');
      return;
    }
    this.registerPublicMcpGateway(config);
  }

  /**
   * The MCP resource server: `/mcp` and its protected-resource metadata, the public way
   * into the notes MCP. It meets the authorization server only through the token
   * verifier. Mounted before express.json() so the body stays a raw stream the proxy can
   * pipe on; reordering it silently breaks MCP.
   */
  private registerPublicMcpGateway(config: OAuthConfig) {
    const internal_url = process.env.MCP_NOTES_INTERNAL_URL;
    const assertion_secret = process.env.MCP_GATEWAY_ASSERTION_SECRET;
    if (!internal_url || !assertion_secret) {
      logger.warn('MCP_NOTES_INTERNAL_URL or MCP_GATEWAY_ASSERTION_SECRET not set; the public /mcp gateway is disabled');
      return;
    }

    this.app.use(PublicMcpGateway.build({
      verifier: new OAuthAccessTokenVerifier(),
      mcp_resource_url: config.mcp_resource_url,
      authorization_server_url: config.issuer_url,
      scopes: NotesScope.ALL,
      internal_url,
      assertion_secret
    }));
    logger.info({ resource: config.mcp_resource_url.toString(), internal_url }, 'Public MCP gateway mounted');
  }

  getApp() {
    return this.app;
  }

  private registerRoutes() {
    const v1_router = express.Router();
    this.app.use('/api/v1', v1_router);
    this.registerV1Routers(v1_router);
  }

  private registerV1Routers(v1_router: express.Router) {

    const auth_controller = new AuthController();
    v1_router.use('/auth', auth_controller.getRouter());

    const ai_controller = new AiController();
    v1_router.use('/ai', ai_controller.getRouter());

    const agent_controller = new AgentController();
    v1_router.use('/agent', agent_controller.getRouter());

    const notes_controller = new NotesController();
    v1_router.use('/notes', notes_controller.getRouter());

    const voice_controller = new VoiceController();
    v1_router.use('/voice', voice_controller.getRouter());

    const onenote_controller = new OneNoteController();
    v1_router.use('/integrations/onenote', onenote_controller.getRouter());

    const health_controller = new HealthController();
    v1_router.use('/health', health_controller.getRouter());

    const admin_controller = new AdminController();
    v1_router.use('/admin', admin_controller.getRouter());

    logger.info(
      { mounts: ['auth', 'ai', 'agent', 'notes', 'voice', 'health', 'admin'] },
      'v1 routes mounted'
    );
  }
}
