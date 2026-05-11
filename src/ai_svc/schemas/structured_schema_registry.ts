import { z } from 'zod';

const RecipeV1Schema = z.object({
  title: z.string(),
  servings: z.number().int().positive(),
  ingredients: z.array(z.object({
    name: z.string(),
    quantity: z.string(),
  })),
  steps: z.array(z.string()),
});

export class StructuredSchemaRegistry {

  private static instance: StructuredSchemaRegistry | null = null;
  private readonly schemas: Map<string, z.ZodTypeAny>;

  private constructor(schemas: Map<string, z.ZodTypeAny>) {
    this.schemas = schemas;
  }

  static getInstance(): StructuredSchemaRegistry {
    if (!StructuredSchemaRegistry.instance) {
      StructuredSchemaRegistry.instance = new StructuredSchemaRegistry(StructuredSchemaRegistry.buildDefaultSchemas());
    }
    return StructuredSchemaRegistry.instance;
  }

  getSchema(name: string): z.ZodTypeAny | null {
    return this.schemas.get(name) ?? null;
  }

  listSchemaNames(): string[] {
    return Array.from(this.schemas.keys());
  }

  private static buildDefaultSchemas(): Map<string, z.ZodTypeAny> {
    return new Map<string, z.ZodTypeAny>([
      ['recipe_v1', RecipeV1Schema],
    ]);
  }
}
