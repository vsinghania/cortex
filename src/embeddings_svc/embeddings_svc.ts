import type { EmbeddingAdapter } from './adapters/embedding_adapter.js';
import { OpenAiEmbeddingAdapter } from './adapters/openai_embedding_adapter.js';
import type { EmbeddingsSvcInterface } from './embeddings_svc_interface.js';
import type { EmbedQueryResult, EmbedTextsResult } from './types/embedding.types.js';

export class EmbeddingsSvc implements EmbeddingsSvcInterface {
  private static instance: EmbeddingsSvc | null = null;

  private constructor(private readonly adapter: EmbeddingAdapter) {}

  static getInstance(): EmbeddingsSvc {
    if (EmbeddingsSvc.instance) return EmbeddingsSvc.instance;
    EmbeddingsSvc.instance = new EmbeddingsSvc(new OpenAiEmbeddingAdapter());
    return EmbeddingsSvc.instance;
  }

  get model(): string {
    return this.adapter.model;
  }

  get dimensions(): number {
    return this.adapter.dimensions;
  }

  async embedTexts(texts: string[]): Promise<EmbedTextsResult> {
    return this.adapter.embedTexts(texts);
  }

  async embedQuery(text: string): Promise<EmbedQueryResult> {
    return this.adapter.embedQuery(text);
  }
}
