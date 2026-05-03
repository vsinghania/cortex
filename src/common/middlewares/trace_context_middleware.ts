import type { Request, Response, NextFunction } from 'express';
import { Id } from '../../lib/id.js';
import { TraceContext } from '../trace_context.js';

declare global {
  namespace Express {
    interface Request {
      trace_id?: string;
    }
  }
}

export class TraceContextMiddleware {
  private constructor() {}

  public static establish(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers['x-request-id'];
    const inbound = Array.isArray(header) ? header[0] : header;
    const trace_id = inbound && inbound.length > 0 ? inbound : Id.generate();
    req.trace_id = trace_id;

    TraceContext.enter({ trace_id, kind: 'http' });
    next();
  }
}
