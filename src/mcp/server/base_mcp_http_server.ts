import express from 'express';
import type { Request, Response } from 'express';
import type { Server } from 'node:http';
import { createMcpHandler, McpServer, type AuthInfo, type McpHttpHandler, type McpRequestContext } from '@modelcontextprotocol/server';
import { hostHeaderValidation, localhostHostValidation, toNodeHandler, type NodeIncomingMessageLike, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { HttpLoggerMiddleware } from '../../common/middlewares/http_logger_middleware.js';
import { logger } from '../../common/logger.js';
import { TraceContext } from '../../common/trace_context.js';
import { TokenUtils } from '../../auth_svc/utils/token_utils.js';
import { Id } from '../../lib/id.js';
import { McpCallers } from './mcp_caller.js';
import { McpCallerAssertion } from './mcp_caller_assertion.js';
import type { McpModule } from './mcp_module.js';
import type { McpCaller, McpHttpConfig, McpHttpServerHandle, McpServerInfo } from './types/mcp_server.types.js';

type HostGuard = (req: Request, res: Response) => boolean;

export abstract class BaseMcpHttpServer {
  private app?: express.Express;
  private http_server?: Server;
  private http_cfg?: McpHttpConfig;
  private server_info?: McpServerInfo;
  private mcp_modules: McpModule[] = [];
  private mcp_handler?: McpHttpHandler;
  private node_handler?: NodeMcpRequestHandler;
  private host_guard?: HostGuard;

  public async start(): Promise<McpHttpServerHandle> {
    this.server_info = this.getServerInfo();
    this.http_cfg = this.getHttpConfig();

    await this.bootstrap();
    this.mcp_modules = await this.createMcpModules();
    this.mcp_handler = this.createHandler();
    this.node_handler = toNodeHandler(this.mcp_handler, { onerror: this.reportError.bind(this) });
    this.host_guard = BaseMcpHttpServer.createHostGuard(this.http_cfg);

    this.app = express();
    this.configureMiddleware(this.app);
    this.registerMcpRoute(this.app, this.http_cfg);

    this.http_server = this.app.listen(this.http_cfg.port, this.http_cfg.host, () => {
      logger.info({
        name: this.server_info?.name,
        host: this.http_cfg?.host,
        port: this.http_cfg?.port,
        path: this.http_cfg?.path
      }, 'MCP HTTP server is ready.');
    });

    this.registerShutdownHandlers();

    return {
      server: this.http_server,
      shutdown: this.stop.bind(this)
    };
  }

  public async stop(): Promise<void> {
    try {
      if (this.http_server) {
        await new Promise<void>((resolve, reject) => {
          this.http_server?.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }

      await this.mcp_handler?.close();
      await this.cleanupMcpModules();
      await this.cleanup();
    } finally {
      this.http_server = undefined;
      this.app = undefined;
      this.http_cfg = undefined;
      this.server_info = undefined;
      this.mcp_modules = [];
      this.mcp_handler = undefined;
      this.node_handler = undefined;
    }
  }

  protected abstract getServerInfo(): McpServerInfo;

  protected abstract getHttpConfig(): McpHttpConfig;

  protected abstract createMcpModules(): Promise<McpModule[]>;

  protected async bootstrap(): Promise<void> {}

  protected async cleanup(): Promise<void> {}

  /** Sent to the client at initialize; a subclass can tailor it to who is asking. */
  protected getInstructions(_caller: McpCaller): string | undefined {
    return undefined;
  }

  /**
   * Who is calling, decided from this request's credentials alone. Exactly the service
   * bearer is an internal caller; a valid gateway assertion is an external or first-party
   * one; anything else is refused. No header's absence ever widens access.
   */
  private authenticate(req: Request): McpCaller | null {
    const cfg = this.requireHttpConfig();
    const token = BaseMcpHttpServer.bearerToken(req);
    if (!token) return null;
    if (TokenUtils.constantTimeEquals(token, cfg.auth_token)) {
      return { kind: 'internal', user_id: BaseMcpHttpServer.singleHeader(req, 'x-user-id') };
    }
    if (!cfg.assertion_secret || !cfg.assertion_audience) return null;
    return McpCallerAssertion.verify({ secret: cfg.assertion_secret, audience: cfg.assertion_audience, token });
  }

  /**
   * Explicit protocol policy: 2026-07-28 clients get the modern per-request exchange,
   * and 2025-era clients (OpenAI Realtime, older connectors) are served
   * statelessly by a fresh instance from the same factory. GET and DELETE, the 2025
   * session operations, answer 405 because nothing is kept between requests.
   */
  private createHandler(): McpHttpHandler {
    return createMcpHandler((ctx) => this.createMcpServer(ctx), {
      legacy: 'stateless',
      onerror: this.reportError.bind(this)
    });
  }

  private configureMiddleware(app: express.Express): void {
    app.use(this.establishTraceContext.bind(this));
    app.use(HttpLoggerMiddleware.build(logger));
  }

  private establishTraceContext(req: Request, _res: Response, next: express.NextFunction): void {
    TraceContext.enter({
      trace_id: Id.generateRandom(),
      upstream_trace_id: BaseMcpHttpServer.singleHeader(req, 'x-trace-id')
    });
    next();
  }

  private static createHostGuard(cfg: McpHttpConfig): HostGuard | undefined {
    if (cfg.allowed_hosts && cfg.allowed_hosts.length > 0) {
      return hostHeaderValidation(cfg.allowed_hosts);
    }

    const localhost_hosts = ['127.0.0.1', 'localhost', '::1'];
    if (localhost_hosts.includes(cfg.host)) {
      return localhostHostValidation();
    }

    if (cfg.host === '0.0.0.0' || cfg.host === '::') {
      logger.warn({ host: cfg.host }, 'MCP server is binding without host header validation.');
    }
    return undefined;
  }

  private registerMcpRoute(app: express.Express, cfg: McpHttpConfig): void {
    const path = BaseMcpHttpServer.normalizePath(cfg.path);
    app.all(path, this.handleRequest.bind(this));
    app.all(`${path}/`, this.handleRequest.bind(this));

    logger.info({ path }, 'MCP HTTP route mounted.');
  }

  private async handleRequest(req: Request, res: Response): Promise<void> {
    if (this.host_guard && !this.host_guard(req, res)) return;

    const caller = this.authenticate(req);
    if (!caller) {
      res.status(401).json(BaseMcpHttpServer.errorResponse(-32001, 'Unauthorized'));
      return;
    }
    if (caller.user_id) TraceContext.setUserId(caller.user_id);

    try {
      await this.requireNodeHandler()(BaseMcpHttpServer.toNodeRequest(req, McpCallers.toAuthInfo(caller)), res);
    } catch (error) {
      logger.error({ err: error }, `${this.requireServerInfo().log_name}_http_request_failed`);
      if (!res.headersSent) {
        res.status(500).json(BaseMcpHttpServer.errorResponse(-32603, 'Internal server error'));
      }
    }
  }

  /**
   * The adapter reads the verified caller from `auth`. Express's own `req.auth` carries
   * this app's session shape, so the adapter gets a view of the request instead.
   */
  private static toNodeRequest(req: Request, auth: AuthInfo): NodeIncomingMessageLike {
    return {
      method: req.method,
      url: req.url,
      headers: req.headers,
      auth,
      [Symbol.asyncIterator]: () => req[Symbol.asyncIterator]()
    };
  }

  /** One fresh server per request, carrying only what this caller may use. */
  private async createMcpServer(ctx: McpRequestContext): Promise<McpServer> {
    const caller = McpCallers.fromAuthInfo(ctx.authInfo);
    if (!caller) throw new Error('MCP request reached the server factory without an authenticated caller.');
    const server_info = this.requireServerInfo();
    const instructions = this.getInstructions(caller);
    const server = new McpServer(
      {
        name: server_info.name,
        version: server_info.version,
        title: server_info.title,
        description: server_info.description,
        websiteUrl: server_info.website_url,
        icons: server_info.icons
      },
      instructions ? { ...server_info.options, instructions } : server_info.options
    );

    for (const mcp_module of this.mcp_modules) {
      await mcp_module.register(server, caller);
    }
    return server;
  }

  private reportError(error: Error): void {
    logger.warn({ err: error }, `${this.server_info?.log_name ?? 'mcp'}_handler_error`);
  }

  private async cleanupMcpModules(): Promise<void> {
    for (const mcp_module of this.mcp_modules) {
      await mcp_module.cleanup();
    }
  }

  private registerShutdownHandlers(): void {
    process.once('SIGINT', this.shutdownProcess.bind(this));
    process.once('SIGTERM', this.shutdownProcess.bind(this));
  }

  private async shutdownProcess(): Promise<void> {
    try {
      await this.stop();
    } finally {
      process.exit(0);
    }
  }

  private requireHttpConfig(): McpHttpConfig {
    if (!this.http_cfg) {
      throw new Error('MCP HTTP config has not been initialized.');
    }

    return this.http_cfg;
  }

  private requireServerInfo(): McpServerInfo {
    if (!this.server_info) {
      throw new Error('MCP server info has not been initialized.');
    }

    return this.server_info;
  }

  private requireNodeHandler(): NodeMcpRequestHandler {
    if (!this.node_handler) {
      throw new Error('MCP handler has not been initialized.');
    }

    return this.node_handler;
  }

  private static bearerToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return /^Bearer$/i.test(scheme ?? '') && token ? token : null;
  }

  private static singleHeader(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    const first = Array.isArray(value) ? value[0] : value;
    return first && first.length > 0 ? first : undefined;
  }

  private static errorResponse(code: number, message: string) {
    return {
      jsonrpc: '2.0',
      error: {
        code,
        message
      },
      id: null
    };
  }

  private static normalizePath(path: string): string {
    if (!path.startsWith('/')) {
      return `/${path}`;
    }

    if (path.length > 1 && path.endsWith('/')) {
      return path.slice(0, -1);
    }

    return path;
  }
}
