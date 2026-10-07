import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '../../common/logger.js';

export interface McpProxyOptions {
  name: string;
  target_url: string;
  /** Runs on every forwarded request, after the inbound headers have been copied. */
  rewriteRequestHeaders?: (proxy_req: ClientRequest, res: ServerResponse) => void;
}

export class McpProxyRouter {
  private constructor() {}

  public static build(opts: McpProxyOptions): express.Router {
    const target = new URL(opts.target_url);
    const target_origin = target.origin;
    const target_pathname = target.pathname.replace(/\/+$/, '');

    const router = express.Router();

    const middleware = createProxyMiddleware<IncomingMessage, ServerResponse>({
      target: target_origin,
      changeOrigin: true,
      xfwd: true,
      pathRewrite: (incoming_path) => McpProxyRouter.rewritePath(target_pathname, incoming_path),
      on: {
        proxyReq: (proxy_req, req, res) => {
          opts.rewriteRequestHeaders?.(proxy_req, res);
          logger.debug(
            { mcp_name: opts.name, method: req.method, url: req.url },
            'MCP proxy request forwarded'
          );
        },
        error: (err, _req, res) => {
          logger.warn(
            { err: err.message, mcp_name: opts.name, target_url: opts.target_url },
            'MCP proxy upstream error'
          );
          McpProxyRouter.writeUpstreamError(res as ServerResponse | undefined);
        },
      },
    });

    router.use('/', middleware);
    return router;
  }

  private static rewritePath(target_pathname: string, incoming_path: string): string {
    const tail = incoming_path === '/' ? '' : incoming_path;
    const rewritten = `${target_pathname}${tail}`;
    return rewritten.length > 0 ? rewritten : '/';
  }

  private static writeUpstreamError(res?: ServerResponse): void {
    if (!res || res.headersSent) {
      return;
    }
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32002, message: 'Upstream MCP unreachable' },
        id: null,
      })
    );
  }
}
