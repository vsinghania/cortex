import { z } from 'zod';
import { NotFoundError } from '../common/errors.js';
import { logExecTime } from '../lib/decorators/logging_decorators.js';
import { AdapterRegistry, DEFAULT_PROVIDER } from './adapters/adapter_registry.js';
import { AdapterStructuredFormat, GenAiAdapter } from './adapters/genai_adapter.js';
import { AiSvcInterface } from './ai_svc_interface.js';
import { StructuredSchemaRegistry } from './schemas/structured_schema_registry.js';
import {
  GenAiProvider,
  GenerateStructuredRequest,
  GenerateStructuredResponse,
  GenerateTextRequest,
  GenerateTextResponse,
  Role,
  StructuredSchemaSource,
} from './types/ai_prompt.types.js';

const SLOW_CALL_THRESHOLD_MS = 10000;

export class AiSvc implements AiSvcInterface {

  private readonly adapter_registry: AdapterRegistry;
  private readonly schema_registry: StructuredSchemaRegistry;

  private constructor(adapter_registry: AdapterRegistry, schema_registry: StructuredSchemaRegistry) {
    this.adapter_registry = adapter_registry;
    this.schema_registry = schema_registry;
  }

  static async create(): Promise<AiSvc> {
    return new AiSvc(AdapterRegistry.getInstance(), StructuredSchemaRegistry.getInstance());
  }

  @logExecTime({ threshold_in_ms: SLOW_CALL_THRESHOLD_MS })
  async generateText(req: GenerateTextRequest): Promise<GenerateTextResponse> {
    const adapter = this.resolveAdapter(req.provider);
    const resp = await adapter.generateText({
      messages: req.messages,
      options: req.options,
    });
    return {
      message: { role: Role.ASSISTANT, content: resp.text },
      model: resp.model,
      usage: resp.usage,
    };
  }

  @logExecTime({ threshold_in_ms: SLOW_CALL_THRESHOLD_MS })
  async generateStructured<T = unknown>(req: GenerateStructuredRequest): Promise<GenerateStructuredResponse<T>> {
    const adapter = this.resolveAdapter(req.provider);
    const format = this.resolveSchemaFormat<T>(req.schema);
    const resp = await adapter.generateStructured<T>({
      messages: req.messages,
      format,
      options: req.options,
    });
    return {
      data: resp.data,
      model: resp.model,
      usage: resp.usage,
    };
  }

  private resolveAdapter(provider: GenAiProvider | undefined): GenAiAdapter {
    return this.adapter_registry.getAdapter(provider ?? DEFAULT_PROVIDER);
  }

  private resolveSchemaFormat<T>(source: StructuredSchemaSource): AdapterStructuredFormat<T> {
    switch (source.kind) {
      case 'registered': {
        const schema = this.schema_registry.getSchema(source.name);
        if (!schema) {
          throw new NotFoundError(`Unknown schema_name: ${source.name}`, {
            details: { schema_name: source.name },
          });
        }
        return { kind: 'zod', name: source.name, schema: schema as z.ZodType<T> };
      }
      case 'zod':
        return { kind: 'zod', name: source.name, schema: source.schema as z.ZodType<T> };
      case 'json_schema':
        return { kind: 'json_schema', name: source.name, schema: source.schema };
    }
  }
}
