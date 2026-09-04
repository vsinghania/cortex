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

const TRACE_ID_HEADER = 'x-request-id';

export class TraceContextMiddleware {
  public static readonly trace_id_header = TRACE_ID_HEADER;

  private constructor() {}

  public static establish(req: Request, res: Response, next: NextFunction) {
    const header = req.headers[TRACE_ID_HEADER];
    const inbound = Array.isArray(header) ? header[0] : header;
    const trace_id = inbound && inbound.length > 0 ? inbound : Id.generateRandom();
    req.trace_id = trace_id;
    res.setHeader(TRACE_ID_HEADER, trace_id);

    TraceContext.enter({ trace_id });
    next();
  }
}
