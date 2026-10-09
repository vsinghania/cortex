import type express from 'express';

/**
 * Serves a router only on one host. web-server answers for both the API host
 * (api.cortexapp.me) and the MCP host (mcp.cortexapp.me); gating keeps each surface on
 * its own host, so `/notes` is not also reachable as api.cortexapp.me/notes. Requests
 * for other hosts pass straight on, which is also why one host for both (local dev)
 * just works.
 */
export class HostGate {
  private constructor() {}

  static createHostRouter(host_url: URL, router: express.RequestHandler): express.RequestHandler {
    const hostname = host_url.hostname;
    return (req, res, next) => (req.hostname === hostname ? router(req, res, next) : next());
  }
}
