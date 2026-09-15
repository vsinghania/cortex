import { z } from 'zod';

export class ZodJsonSchema {
  private constructor() {}

  static toJsonSchema(schema: z.ZodType): Record<string, unknown> {
    const { $schema: _ignored, ...json_schema } = z.toJSONSchema(schema, { target: 'draft-7' });
    return json_schema;
  }
}
