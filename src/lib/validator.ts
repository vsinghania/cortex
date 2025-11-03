import { z } from 'zod';
import { ValidationError } from '../common/errors.js';
import { logger } from '../common/logger.js';
export class Validator {

  /**
   * ! @deprecated
   */
  static validateAndReturn<T>(schema: z.ZodType<T>, data: T): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      logger.info(JSON.stringify(result));
      throw new ValidationError("Invalid request payload", { details: { issues: result.error.issues } });
    }
    return result.data;
  }

  private constructor() {};
}
