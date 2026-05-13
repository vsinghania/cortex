import { VoiceProvider } from '../types/voice.types.js';
import { OpenAiRealtimeAdapter } from './openai_realtime_adapter.js';
import { RealtimeVoiceAdapter } from './realtime_voice_adapter.js';

export const DEFAULT_VOICE_PROVIDER: VoiceProvider = 'openai';

export class VoiceAdapterRegistry {

  private static instance: VoiceAdapterRegistry | null = null;
  private readonly adapters: Map<VoiceProvider, RealtimeVoiceAdapter>;

  private constructor(adapters: Map<VoiceProvider, RealtimeVoiceAdapter>) {
    this.adapters = adapters;
  }

  public static getInstance(): VoiceAdapterRegistry {
    if (!VoiceAdapterRegistry.instance) {
      VoiceAdapterRegistry.instance = new VoiceAdapterRegistry(VoiceAdapterRegistry.buildAdapters());
    }
    return VoiceAdapterRegistry.instance;
  }

  public getAdapter(provider: VoiceProvider): RealtimeVoiceAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`No realtime voice adapter registered for provider: ${provider}`);
    }
    return adapter;
  }

  public listProviders(): VoiceProvider[] {
    return Array.from(this.adapters.keys());
  }

  private static buildAdapters(): Map<VoiceProvider, RealtimeVoiceAdapter> {
    return new Map<VoiceProvider, RealtimeVoiceAdapter>([
      ['openai', OpenAiRealtimeAdapter.create()],
    ]);
  }
}
