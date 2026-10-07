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
import { HostGate } from './mcp/host_gate.js';
import { OAuthAccessTokenVerifier } from '../oauth_svc/oauth_access_token_verifier.js';
import { McpResourceCatalog } from '../mcp/resource/mcp_resource_catalog.js';
import { McpPublicConfigLoader } from '../mcp/resource/config/mcp_public_config.js';

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
    this.registerPublicMcpGateways();

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

  /**
   * The MCP resource servers: one gateway per enabled resource (`/notes`, later
   * `/articles`, …) on the MCP host, each with its protected-resource metadata. They meet
   * the authorization server only through the token verifier. Mounted before
   * express.json() so the body stays a raw stream the proxy can pipe on; reordering it
   * silently breaks MCP.
   */
  private registerPublicMcpGateways() {
    const config = McpPublicConfigLoader.fromEnv();
    if (!config) {
      logger.warn('MCP_PUBLIC_BASE_URL not set; the public MCP resource servers are disabled');
      return;
    }
    const assertion_secret = process.env.MCP_GATEWAY_ASSERTION_SECRET;
    if (!assertion_secret) {
      logger.warn('MCP_GATEWAY_ASSERTION_SECRET not set; the public MCP resource servers are disabled');
      return;
    }
    const catalog = McpResourceCatalog.create({ base_url: config.base_url });
    if (catalog.all().length === 0) {
      logger.warn('No MCP server has its internal URL set; no public MCP resource is served');
      return;
    }

    const verifier = new OAuthAccessTokenVerifier();
    const gateways = express.Router();
    for (const resource of catalog.all()) {
      gateways.use(PublicMcpGateway.build({ verifier, resource, authorization_server_url: config.authorization_server_url, assertion_secret }));
    }
    // web-server also answers for the API host; keeping the resource servers on the MCP
    // host means api.cortexapp.me/notes is not a second URL for the same resource.
    this.app.use(HostGate.for(config.base_url, gateways));
    logger.info({ resources: catalog.all().map((resource) => resource.url) }, 'Public MCP gateways mounted');
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
