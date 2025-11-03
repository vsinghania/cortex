import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../../user/types/user.types.js';
import { ForbiddenError, UnauthorizedError } from '../errors.js';

/**
 * Requires an authenticated user (from requireAuth) and ensures the user has at least one of the allowed roles.
 * Use after requireAuth middleware.
 */
export class AuthorizeMiddleware {
  private constructor() {}
  public static authorizeRoles(...allowed: Role[]) {
    return (req: Request, _res: Response, next: NextFunction) => {
      try {
        if (!req.auth) {
          throw new UnauthorizedError('Authentication required');
        }
        if (allowed.length === 0) {
          return next();
        }
        const user_roles = new Set(req.auth.roles ?? []);
        const ok = allowed.some(r => user_roles.has(r));
        if (!ok) {
          throw new ForbiddenError('Insufficient role');
        }
        next();
      } catch (e) {
        next(e);
      }
    };
  }
}
