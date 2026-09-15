import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class ZodJsonSchema {
  private constructor() {}

  static toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    const { $schema: _ignored, ...json_schema } = zodToJsonSchema(schema, {
      $refStrategy: 'none',
      target: 'jsonSchema7',
    }) as Record<string, unknown>;
    return json_schema;
  }
}
