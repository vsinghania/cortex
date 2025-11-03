import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../../user/types/user.types.js';
import { UnauthorizedError } from '../errors.js';
import { verifyAccessToken } from '../../auth_svc/utils/token_utils.js';

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

function extractBearerToken(req: Request): string | null {
  const header = req.headers['authorization'] || req.headers['Authorization'] as string | undefined;
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (!/^Bearer$/i.test(scheme)) return null;
  return token || null;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new UnauthorizedError('Missing bearer token', { headers: { 'WWW-Authenticate': 'Bearer' } });
    }
    const claims = verifyAccessToken(token);
    if (!claims) {
      throw new UnauthorizedError('Invalid or expired token', { headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } });
    }
    req.auth = { user_id: claims.sub, roles: claims.roles as Role[] };
    next();
  } catch (e) {
    next(e);
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(req);
    if (!token) return next();
    const claims = verifyAccessToken(token);
    if (!claims) return next();
    req.auth = { user_id: claims.sub, roles: claims.roles as Role[] };
    next();
  } catch {
    // Do not fail the request on optional auth
    next();
  }
}
