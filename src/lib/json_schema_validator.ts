import { Ajv } from 'ajv';
import { BadRequestError } from '../common/errors.js';

export class JsonSchemaValidator {
  private static ajv_instance: Ajv | null = null;

  private constructor() {}

  static isValidJsonSchema(schema: unknown): boolean {
    if (!JsonSchemaValidator.isObject(schema)) return false;
    const ajv = JsonSchemaValidator.getAjv();
    return ajv.validateSchema(schema, false) === true;
  }

  static assertValidJsonSchema(
    schema: unknown
  ): asserts schema is Record<string, unknown> {
    if (!JsonSchemaValidator.isObject(schema)) {
      throw new BadRequestError('output_schema must be a JSON object');
    }
    const ajv = JsonSchemaValidator.getAjv();
    const ok = ajv.validateSchema(schema, false);
    if (ok !== true) {
      throw new BadRequestError('Invalid JSON Schema', {
        details: { errors: ajv.errors ?? [] },
      });
    }
  }

  private static getAjv(): Ajv {
    if (!JsonSchemaValidator.ajv_instance) {
      JsonSchemaValidator.ajv_instance = new Ajv({
        strict: false,
        allErrors: true,
        validateSchema: true,
      });
    }
    return JsonSchemaValidator.ajv_instance;
  }

  private static isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
