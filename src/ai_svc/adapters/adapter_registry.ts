import { GenAiProvider } from '../types/ai_prompt.types.js';
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
    return new Map<GenAiProvider, GenAiAdapter>([
      ['openai', OpenAiAdapter.create()],
    ]);
  }
}
