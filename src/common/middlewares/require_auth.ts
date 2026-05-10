import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../../user/types/user.types.js';
import { UnauthorizedError } from '../errors.js';
import { TokenUtils } from '../../auth_svc/utils/token_utils.js';
import { TraceContext } from '../trace_context.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user_id: string;
        roles: Role[];
      };
    }
  }
}

export class RequireAuthMiddleware {
  private constructor() {}

  private static extractBearerToken(req: Request): string | null {
    const header = req.headers['authorization'] || (req.headers['Authorization'] as string | undefined);
    if (!header) return null;
    const parts = header.split(' ');
    if (parts.length !== 2) return null;
    const [scheme, token] = parts;
    if (!/^Bearer$/i.test(scheme)) return null;
    return token || null;
  }

  public static requireAuth(req: Request, _res: Response, next: NextFunction) {
    try {
      const token = RequireAuthMiddleware.extractBearerToken(req);
      if (!token) {
        throw new UnauthorizedError('Missing bearer token', { headers: { 'WWW-Authenticate': 'Bearer' } });
      }
      const claims = TokenUtils.verifyAccessToken(token);
      if (!claims) {
        throw new UnauthorizedError('Invalid or expired token', { headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } });
      }
      req.auth = { user_id: claims.sub, roles: claims.roles as Role[] };
      TraceContext.setUserId(claims.sub);
      next();
    } catch (e) {
      next(e);
    }
  }

  public static optionalAuth(req: Request, _res: Response, next: NextFunction) {
    try {
      const token = RequireAuthMiddleware.extractBearerToken(req);
      if (!token) return next();
      const claims = TokenUtils.verifyAccessToken(token);
      if (!claims) return next();
      req.auth = { user_id: claims.sub, roles: claims.roles as Role[] };
      TraceContext.setUserId(claims.sub);
      next();
    } catch {
      // Do not fail the request on optional auth
      next();
    }
  }
}
