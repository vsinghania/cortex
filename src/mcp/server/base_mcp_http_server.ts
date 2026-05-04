import express from 'express';
import type { Request, Response } from 'express';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hostHeaderValidation, localhostHostValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { pinoHttp } from 'pino-http';
import { logger } from '../../common/logger.js';
import { TraceContext } from '../../common/trace_context.js';
import { Id } from '../../lib/id.js';
import type { McpModule } from './mcp_module.js';
import type { McpHttpConfig, McpHttpServerHandle, McpServerInfo } from './types/mcp_server.types.js';

export abstract class BaseMcpHttpServer {
  private app?: express.Express;
  private http_server?: Server;
  private http_cfg?: McpHttpConfig;
  private server_info?: McpServerInfo;
  private mcp_modules: McpModule[] = [];

  public async start(): Promise<McpHttpServerHandle> {
    this.server_info = this.getServerInfo();
    this.http_cfg = this.getHttpConfig();

    await this.bootstrap();
    this.mcp_modules = await this.createMcpModules();

    this.app = express();
    this.configureMiddleware(this.app, this.http_cfg);
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

      await this.cleanupMcpModules();
      await this.cleanup();
    } finally {
      this.http_server = undefined;
      this.app = undefined;
      this.http_cfg = undefined;
      this.server_info = undefined;
      this.mcp_modules = [];
    }
  }

  protected abstract getServerInfo(): McpServerInfo;

  protected abstract getHttpConfig(): McpHttpConfig;

  protected abstract createMcpModules(): Promise<McpModule[]>;

  protected async bootstrap(): Promise<void> {}

  protected async cleanup(): Promise<void> {}

  private configureMiddleware(app: express.Express, cfg: McpHttpConfig): void {
    app.use(express.json());
    this.configureHostValidation(app, cfg);
    app.use(this.establishTraceContext.bind(this));
    app.use(pinoHttp({ logger, autoLogging: true }));
  }

  private establishTraceContext(req: Request, _res: Response, next: express.NextFunction): void {
    const trace_header = req.headers['x-trace-id'];
    const inbound_trace = Array.isArray(trace_header) ? trace_header[0] : trace_header;
    const upstream_trace_id = inbound_trace && inbound_trace.length > 0 ? inbound_trace : undefined;

    const user_header = req.headers['x-user-id'];
    const inbound_user = Array.isArray(user_header) ? user_header[0] : user_header;
    const user_id = inbound_user && inbound_user.length > 0 ? inbound_user : undefined;

    TraceContext.enter({
      trace_id: upstream_trace_id ?? Id.generate(),
      kind: 'http',
      upstream_trace_id,
      user_id,
    });
    next();
  }

  private configureHostValidation(app: express.Express, cfg: McpHttpConfig): void {
    if (cfg.allowed_hosts && cfg.allowed_hosts.length > 0) {
      app.use(hostHeaderValidation(cfg.allowed_hosts));
      return;
    }

    const localhost_hosts = ['127.0.0.1', 'localhost', '::1'];
    if (localhost_hosts.includes(cfg.host)) {
      app.use(localhostHostValidation());
      return;
    }

    if (cfg.host === '0.0.0.0' || cfg.host === '::') {
      logger.warn({ host: cfg.host }, 'MCP server is binding without host header validation.');
    }
  }

  private registerMcpRoute(app: express.Express, cfg: McpHttpConfig): void {
    const path = BaseMcpHttpServer.normalizePath(cfg.path);
    app.all(path, this.handleRequest.bind(this));
    app.all(`${path}/`, this.handleRequest.bind(this));

    logger.info({ path }, 'MCP HTTP route mounted.');
  }

  private async handleRequest(req: Request, res: Response): Promise<void> {
    const cfg = this.requireHttpConfig();

    if (!this.authorize(req, res, cfg)) {
      return;
    }

    if (req.method === 'POST') {
      await this.handlePost(req, res);
      return;
    }

    this.handleMethodNotAllowed(res);
  }

  private authorize(req: Request, res: Response, cfg: McpHttpConfig): boolean {
    const auth_header = req.headers.authorization;
    const expected_header = `Bearer ${cfg.auth_token}`;

    if (auth_header !== expected_header) {
      res.status(401).json(BaseMcpHttpServer.errorResponse(-32001, 'Unauthorized'));
      return false;
    }

    return true;
  }

  private async handlePost(req: Request, res: Response): Promise<void> {
    const mcp_server = await this.createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    try {
      await mcp_server.connect(transport);
      await transport.handleRequest(req as any, res, req.body);
    } catch (error) {
      logger.error({ err: error }, `${this.requireServerInfo().log_name}_http_request_failed`);
      if (!res.headersSent) {
        res.status(500).json(BaseMcpHttpServer.errorResponse(-32603, 'Internal server error'));
      }
    } finally {
      await this.closeTransport(transport);
      await this.closeMcpServer(mcp_server);
    }
  }

  private async createMcpServer(): Promise<McpServer> {
    const server_info = this.requireServerInfo();
    const server = new McpServer(
      { name: server_info.name, version: server_info.version },
      server_info.options
    );

    await this.registerMcpModules(server);
    return server;
  }

  private async registerMcpModules(server: McpServer): Promise<void> {
    for (const mcp_module of this.mcp_modules) {
      await mcp_module.register(server);
    }
  }

  private async cleanupMcpModules(): Promise<void> {
    for (const mcp_module of this.mcp_modules) {
      await mcp_module.cleanup();
    }
  }

  private handleMethodNotAllowed(res: Response): void {
    res.status(405).json(BaseMcpHttpServer.errorResponse(-32000, 'Method not allowed.'));
  }

  private async closeTransport(transport: StreamableHTTPServerTransport): Promise<void> {
    try {
      await transport.close();
    } catch (error) {
      logger.warn({ err: error }, `${this.requireServerInfo().log_name}_transport_close_failed`);
    }
  }

  private async closeMcpServer(mcp_server: McpServer): Promise<void> {
    try {
      await mcp_server.close();
    } catch (error) {
      logger.warn({ err: error }, `${this.requireServerInfo().log_name}_server_close_failed`);
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
