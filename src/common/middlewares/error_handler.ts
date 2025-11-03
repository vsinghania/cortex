import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import { HttpError, NotFoundError } from '../errors.js';

export class ErrorHandlerMiddleware {
  private constructor() {}
  public static notFoundHandler(req: Request, _res: Response, next: NextFunction) {
    next(new NotFoundError(req.originalUrl));
  }

  public static errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
    const { status: status_code, body, headers, http_error } = HttpError.toResponse(err, req.originalUrl);
    if (status_code >= 500) {
      logger.error({
        err: http_error,
        status: status_code,
        path: req.originalUrl
      }, "request failed with server error");
    } else {
      logger.error({
        status: status_code,
        path: req.originalUrl,
        details: http_error.details
      }, "request failed with client error");
    }
    res.set(headers).status(status_code).json(body);
  }
}
