import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import express  from 'express';
import { ValidationError } from '../../common/errors.js';
import { formatIssues } from '../../common/middlewares/validate.js';

type Schemas = {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  headers?: z.ZodTypeAny;
  auth?: z.ZodTypeAny;
};


export function validateRequest(schema: Schemas) {

  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: express.Request, response: express.Response, next: express.NextFunction) {
      try {
        if (schema.body) {
          const parsedBody = schema.body.safeParse(request.body);
          if (!parsedBody?.success) {
            throw new ValidationError("Invalid request body",
              { details: { where: "body", issues: formatIssues(parsedBody?.error?.issues || []) } });
          }
        }

        if (schema.query) {
          const parsedQuery = schema.query.safeParse(request.query);
          if (!parsedQuery?.success) {
            throw new ValidationError("Invalid query parameters",
              { details: { where: "query", issues: formatIssues(parsedQuery?.error?.issues || []) } });
          }
        }

        if (schema.params) {
          const parsedParams = schema.params.safeParse(request.params);
          if (!parsedParams?.success) {
            throw new ValidationError("Invalid parameters",
              { details: { where: "params", issues: formatIssues(parsedParams?.error?.issues || []) } });
          }
        }

        if (schema.headers) {
          const parsedHeaders = schema.headers.safeParse(request.headers);
          if (!parsedHeaders?.success) {
            throw new ValidationError("Invalid headers",
              { details: { where: "headers", issues: formatIssues(parsedHeaders?.error?.issues || []) } });
          }
        }

        return await originalMethod.apply(this, [request, response, next]);
      } catch (e) {
        next(e);
      }
    }
  }
}

