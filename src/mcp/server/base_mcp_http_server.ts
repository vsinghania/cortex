import express from 'express';
import type { Request, Response } from 'express';
import { createServer } from 'node:http';
import { createMcpHandler, McpServer, type AuthInfo, type McpRequestContext } from '@modelcontextprotocol/server';
import { hostHeaderValidation, localhostHostValidation, toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { HttpLoggerMiddleware } from '../../common/middlewares/http_logger_middleware.js';
import { logger } from '../../common/logger.js';
import { TraceContext } from '../../common/trace_context.js';
import { TokenUtils } from '../../auth_svc/utils/token_utils.js';
import { Id } from '../../lib/id.js';
import { BearerToken } from '../../lib/bearer_token.js';
import { McpCallers } from './mcp_caller.js';
import { McpCallerAssertion } from './mcp_caller_assertion.js';
import type { McpModule } from './mcp_module.js';
import type { HostGuard, McpHttpRuntime } from './types/mcp_http_runtime.types.js';
import type { McpCaller, McpHttpConfig, McpHttpServerHandle, McpServerInfo } from './types/mcp_server.types.js';

export abstract class BaseMcpHttpServer {
  private runtime?: McpHttpRuntime;
  private stop_in_flight?: Promise<void>;
  private readonly shutdown_process = this.shutdownServerProcess.bind(this);

  public async start(): Promise<McpHttpServerHandle> {
    if (this.runtime) throw new Error('MCP HTTP server is already started.');
    const server_info = this.getServerInfo();
    const http_cfg = this.getHttpConfig();
    await this.bootstrap();
    const mcp_modules = await this.createMcpModules();
    const report_error = (err: Error) => this.logMcpHandlerError(server_info, err);
    // Both protocol eras use this factory; legacy clients retain stateless HTTP exchanges.
    const mcp_handler = createMcpHandler((ctx) => this.createMcpServer(server_info, mcp_modules, ctx), {
      legacy: 'stateless',
      onerror: report_error
    });
    const app = express();
    const runtime: McpHttpRuntime = {
      http_server: createServer(app),
      http_cfg,
      server_info,
      mcp_modules,
      mcp_handler,
      node_handler: toNodeHandler(mcp_handler, { onerror: report_error }),
      host_guard: BaseMcpHttpServer.createHostHeaderGuard(http_cfg)
    };
    this.configureHttpMiddleware(app);
    this.registerMcpRoute(app, runtime);
    this.runtime = runtime;

    try {
      await BaseMcpHttpServer.listenForHttpRequests(runtime);
      process.once('SIGINT', this.shutdown_process);
      process.once('SIGTERM', this.shutdown_process);
    } catch (err) {
      await this.stop();
      throw err;
    }
    logger.info({ name: server_info.name, host: http_cfg.host, port: http_cfg.port, path: http_cfg.path }, 'MCP HTTP server started');
    return { server: runtime.http_server, shutdown: this.stop.bind(this) };
  }

  public async stop(): Promise<void> {
    if (this.stop_in_flight) return this.stop_in_flight;
    if (!this.runtime) return;
    this.stop_in_flight = this.closeHttpServerRuntime(this.runtime);
    return this.stop_in_flight;
  }

  private async closeHttpServerRuntime(runtime: McpHttpRuntime): Promise<void> {
    try {
      if (runtime.http_server.listening) {
        await new Promise<void>((resolve, reject) => {
          runtime.http_server.close((err) => err ? reject(err) : resolve());
        });
      }
      await runtime.mcp_handler.close();
      for (const mcp_module of runtime.mcp_modules) await mcp_module.cleanup();
      await this.cleanup();
    } finally {
      process.removeListener('SIGINT', this.shutdown_process);
      process.removeListener('SIGTERM', this.shutdown_process);
      this.runtime = undefined;
      this.stop_in_flight = undefined;
    }
  }

  private static listenForHttpRequests(runtime: McpHttpRuntime): Promise<void> {
    return new Promise((resolve, reject) => {
      runtime.http_server.once('error', reject);
      runtime.http_server.listen(runtime.http_cfg.port, runtime.http_cfg.host, () => {
        runtime.http_server.removeListener('error', reject);
        resolve();
      });
    });
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
  private authenticateMcpCaller(req: Request, cfg: McpHttpConfig): McpCaller | null {
    const token = BearerToken.parseAuthorizationHeader(req.headers.authorization);
    if (!token) return null;
    if (TokenUtils.constantTimeEquals(token, cfg.auth_token)) {
      return { kind: 'internal', user_id: BaseMcpHttpServer.getSingleRequestHeader(req, 'x-user-id') };
    }
    if (!cfg.assertion_secret || !cfg.assertion_audience) return null;
    return McpCallerAssertion.verifyGatewayCallerAssertion({ secret: cfg.assertion_secret, audience: cfg.assertion_audience, token });
  }

  private configureHttpMiddleware(app: express.Express): void {
    app.use(this.establishRequestTraceContext.bind(this));
    app.use(HttpLoggerMiddleware.build(logger));
  }

  private establishRequestTraceContext(req: Request, _res: Response, next: express.NextFunction): void {
    TraceContext.enter({
      trace_id: Id.generateRandom(),
      upstream_trace_id: BaseMcpHttpServer.getSingleRequestHeader(req, 'x-trace-id')
    });
    next();
  }

  private static createHostHeaderGuard(cfg: McpHttpConfig): HostGuard | undefined {
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

  private registerMcpRoute(app: express.Express, runtime: McpHttpRuntime): void {
    const path = BaseMcpHttpServer.normalizeMcpRoutePath(runtime.http_cfg.path);
    const handle_request = this.handleMcpHttpRequest.bind(this, runtime);
    app.all(path, handle_request);
    app.all(`${path}/`, handle_request);

    logger.info({ path }, 'MCP HTTP route mounted');
  }

  private async handleMcpHttpRequest(runtime: McpHttpRuntime, req: Request, res: Response): Promise<void> {
    if (runtime.host_guard && !runtime.host_guard(req, res)) return;

    const caller = this.authenticateMcpCaller(req, runtime.http_cfg);
    if (!caller) {
      res.status(401).json(BaseMcpHttpServer.buildJsonRpcErrorResponse(-32001, 'Unauthorized'));
      return;
    }
    if (caller.user_id) TraceContext.setUserId(caller.user_id);

    try {
      await runtime.node_handler(BaseMcpHttpServer.toAuthenticatedNodeRequest(req, McpCallers.toSdkAuthInfo(caller)), res);
    } catch (err) {
      logger.error({ err, server: runtime.server_info.log_name }, 'MCP HTTP request failed');
      if (!res.headersSent) {
        res.status(500).json(BaseMcpHttpServer.buildJsonRpcErrorResponse(-32603, 'Internal server error'));
      }
    }
  }

  /**
   * The adapter reads the verified caller from `auth`. Express's own `req.auth` carries
   * this app's session shape, so the adapter gets a view of the request instead.
   */
  private static toAuthenticatedNodeRequest(req: Request, auth: AuthInfo): NodeIncomingMessageLike {
    return {
      method: req.method,
      url: req.url,
      headers: req.headers,
      auth,
      [Symbol.asyncIterator]: () => req[Symbol.asyncIterator]()
    };
  }

  /** One fresh server per request, carrying only what this caller may use. */
  private async createMcpServer(server_info: McpServerInfo, mcp_modules: McpModule[], ctx: McpRequestContext): Promise<McpServer> {
    const caller = McpCallers.fromSdkAuthInfo(ctx.authInfo);
    if (!caller) throw new Error('MCP request reached the server factory without an authenticated caller.');
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

    for (const mcp_module of mcp_modules) {
      await mcp_module.registerCapabilities(server, caller);
    }
    return server;
  }

  private logMcpHandlerError(server_info: McpServerInfo, err: Error): void {
    logger.warn({ err, server: server_info.log_name }, 'MCP HTTP handler failed');
  }

  private async shutdownServerProcess(): Promise<void> {
    try {
      await this.stop();
    } finally {
      process.exit(0);
    }
  }

  private static getSingleRequestHeader(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    const first = Array.isArray(value) ? value[0] : value;
    return first && first.length > 0 ? first : undefined;
  }

  private static buildJsonRpcErrorResponse(code: number, message: string) {
    return {
      jsonrpc: '2.0',
      error: {
        code,
        message
      },
      id: null
    };
  }

  private static normalizeMcpRoutePath(path: string): string {
    if (!path.startsWith('/')) {
      return `/${path}`;
    }

    if (path.length > 1 && path.endsWith('/')) {
      return path.slice(0, -1);
    }

    return path;
  }
}
