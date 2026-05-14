import type pino from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

export class HttpLoggerMiddleware {
  private constructor() {}

  public static build(logger: pino.Logger): HttpLogger {
    return pinoHttp({
      logger,
      autoLogging: true,

      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },

      serializers: {
        req: (req) => {
          const slim = { method: req.method, url: req.url };
          const status_code = req.raw?.res?.statusCode;
          if (HttpLoggerMiddleware.shouldIncludeDetails(logger, status_code)) {
            return { ...slim, headers: req.headers };
          }
          return slim;
        },
        res: (res) => {
          const slim = { status_code: res.statusCode };
          if (HttpLoggerMiddleware.shouldIncludeDetails(logger, res.statusCode)) {
            const headers = typeof res.getHeaders === 'function' ? res.getHeaders() : {};
            return { ...slim, headers };
          }
          return slim;
        },
      },

      customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
      customErrorMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
    });
  }

  private static shouldIncludeDetails(logger: pino.Logger, status_code: number | undefined): boolean {
    if (logger.isLevelEnabled('debug')) return true;
    if (status_code !== undefined && status_code >= 400) return true;
    return false;
  }
}
