import OpenAI from 'openai';
import { performance } from 'node:perf_hooks';
import type { EmbeddingAdapter } from './embedding_adapter.js';
import type { EmbedQueryResult, EmbedTextsResult } from '../types/embedding.types.js';
import { logger } from '../../common/logger.js';
import { logExecTime } from '../../lib/decorators/logging_decorators.js';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 96;

const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536
};

export class OpenAiEmbeddingAdapter implements EmbeddingAdapter {
  readonly model: string;
  readonly dimensions: number;
  private readonly client: OpenAI;
  private readonly default_timeout_ms: number;
  private readonly default_retries: number;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL;
    this.dimensions = MODEL_DIMENSIONS[this.model] ?? DEFAULT_DIMENSIONS;
    this.default_timeout_ms = Number(process.env.OPENAI_TIMEOUT_MS) || 20000;
    this.default_retries = Number(process.env.OPENAI_RETRIES) || 3;
  }

  @logExecTime({ threshold_in_ms: 5000 })
  async embedTexts(texts: string[]): Promise<EmbedTextsResult> {
    if (texts.length === 0) {
      return { vectors: [], model: this.model, usage: { prompt_tokens: 0, total_tokens: 0 } };
    }

    const batches = OpenAiEmbeddingAdapter.toBatches(texts, MAX_BATCH_SIZE);
    const vectors: number[][] = new Array(texts.length);
    let prompt_tokens = 0;
    let total_tokens = 0;
    let model_name = this.model;

    let cursor = 0;
    for (const batch of batches) {
      const start_ms = performance.now();
      const resp = await this.embedBatchWithRetry(batch);
      const duration_ms = Number((performance.now() - start_ms).toFixed(1));

      for (const item of resp.data) {
        vectors[cursor + item.index] = item.embedding;
      }
      cursor += batch.length;
      model_name = resp.model;
      prompt_tokens += resp.usage?.prompt_tokens ?? 0;
      total_tokens += resp.usage?.total_tokens ?? 0;

      logger.debug(
        { batch_size: batch.length, model: resp.model, duration_ms },
        'embedding batch completed'
      );
    }

    logger.info(
      {
        text_count: texts.length,
        batches: batches.length,
        model: model_name,
        prompt_tokens,
        total_tokens
      },
      'embeddings generated'
    );

    return {
      vectors,
      model: model_name,
      usage: { prompt_tokens, total_tokens }
    };
  }

  async embedQuery(text: string): Promise<EmbedQueryResult> {
    const result = await this.embedTexts([text]);
    return {
      vector: result.vectors[0],
      model: result.model,
      usage: result.usage
    };
  }

  private async embedBatchWithRetry(batch: string[]): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.default_timeout_ms);
      try {
        const resp = await this.client.embeddings.create(
          {
            model: this.model,
            input: batch
          },
          { signal: controller.signal }
        );
        clearTimeout(timer);
        return resp;
      } catch (err) {
        clearTimeout(timer);
        attempt++;
        if (attempt > this.default_retries) {
          logger.error({ err, attempt, batch_size: batch.length }, 'embedding call failed after retries');
          throw err;
        }
        logger.warn({ err, attempt, batch_size: batch.length }, 'embedding call failed, retrying');
      }
    }
  }

  private static toBatches<T>(items: T[], batch_size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batch_size) {
      batches.push(items.slice(i, i + batch_size));
    }
    return batches;
  }
}
