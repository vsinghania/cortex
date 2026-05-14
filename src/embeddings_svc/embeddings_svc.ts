import type { EmbeddingAdapter } from './adapters/embedding_adapter.js';
import { OpenAiEmbeddingAdapter } from './adapters/openai_embedding_adapter.js';
import type { EmbeddingsSvcInterface } from './embeddings_svc_interface.js';
import type { EmbedQueryResult, EmbedTextsResult } from './types/embedding.types.js';
import { Time } from '../lib/time.js';
import { logger } from '../common/logger.js';

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
    const start_ms = performance.now();
    const result = await this.adapter.embedTexts(texts);
    logger.info(
      {
        text_count: texts.length,
        model: this.adapter.model,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'texts embedded'
    );
    return result;
  }

  async embedQuery(text: string): Promise<EmbedQueryResult> {
    const start_ms = performance.now();
    const result = await this.adapter.embedQuery(text);
    logger.info(
      {
        query_chars: text.length,
        model: this.adapter.model,
        duration_ms: Time.elapsedMs(start_ms)
      },
      'query embedded'
    );
    return result;
  }
}
