import { logger } from '../../common/logger.js';
import { GenAiProvider } from '../types/ai_prompt.types.js';
import { AnthropicAdapter } from './anthropic_adapter.js';
import { GenAiAdapter } from './genai_adapter.js';
import { OpenAiAdapter } from './openai_adapter.js';

export const DEFAULT_PROVIDER: GenAiProvider = 'openai';

export class AdapterRegistry {

  private static instance: AdapterRegistry | null = null;
  private readonly adapters: Map<GenAiProvider, GenAiAdapter>;

  private constructor(adapters: Map<GenAiProvider, GenAiAdapter>) {
    this.adapters = adapters;
  }

  static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry(AdapterRegistry.buildAdapters());
    }
    return AdapterRegistry.instance;
  }

  getAdapter(provider: GenAiProvider): GenAiAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`No adapter registered for provider: ${provider}`);
    }
    return adapter;
  }

  listProviders(): GenAiProvider[] {
    return Array.from(this.adapters.keys());
  }

  private static buildAdapters(): Map<GenAiProvider, GenAiAdapter> {
    const adapters = new Map<GenAiProvider, GenAiAdapter>([
      ['openai', OpenAiAdapter.create()],
    ]);
    if (process.env.ANTHROPIC_API_KEY) {
      adapters.set('anthropic', AnthropicAdapter.create());
    } else {
      logger.debug('Anthropic adapter skipped, ANTHROPIC_API_KEY is not set');
    }
    return adapters;
  }
}
