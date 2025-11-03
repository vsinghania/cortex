import type { Request, Response, NextFunction } from "express";
import type { ZodTypeAny } from "zod";
import { ValidationError } from '../errors.js';

type Schemas = Partial<{
  body: ZodTypeAny;
  query: ZodTypeAny;
  params: ZodTypeAny;
  headers: ZodTypeAny;
}>;

declare global {
  namespace Express {
    interface Request {
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
        headers?: unknown;
      };
    }
  }
}

export class ValidationMiddleware {
  private constructor() {}

  public static formatIssues(issues: any[]) {
    return issues.map(i => ({ path: i.path.join("."), message: i.message }));
  }

  public static validate(schemas: Schemas) {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        if (schemas.params) {
          const parsed = schemas.params.safeParse(req.params);
          if (!parsed.success) {
            throw new ValidationError("Invalid parameters", { details: { where: "params", issues: ValidationMiddleware.formatIssues(parsed.error.issues) } });
          }
          req.validated = { ...(req.validated ?? {}), params: parsed.data };
        }
        if (schemas.query) {
          const parsed = schemas.query.safeParse(req.query);
          if (!parsed.success) {
            throw new ValidationError("Invalid query parameters", { details: { where: "query", issues: ValidationMiddleware.formatIssues(parsed.error.issues) } });
          }
          req.validated = { ...(req.validated ?? {}), query: parsed.data };
        }
        if (schemas.headers) {
          const parsed = schemas.headers.safeParse(req.headers);
          if (!parsed.success) {
            throw new ValidationError("Invalid headers", { details: { where: "headers", issues: ValidationMiddleware.formatIssues(parsed.error.issues) } });
          }
          req.validated = { ...(req.validated ?? {}), headers: parsed.data };
        }
        if (schemas.body) {
          const parsed = schemas.body.safeParse(req.body);
          if (!parsed.success) {
            throw new ValidationError("Invalid request body", { details: { where: "body", issues: ValidationMiddleware.formatIssues(parsed.error.issues) } });
          }
          req.validated = { ...(req.validated ?? {}), body: parsed.data };
        }
        next();
      } catch (e) {
        next(e);
      }
    };
  }
}
