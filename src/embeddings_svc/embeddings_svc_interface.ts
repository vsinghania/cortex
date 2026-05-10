import type { EmbedQueryResult, EmbedTextsResult } from './types/embedding.types.js';

export interface EmbeddingsSvcInterface {
  readonly model: string;
  readonly dimensions: number;

  embedTexts(texts: string[]): Promise<EmbedTextsResult>;
  embedQuery(text: string): Promise<EmbedQueryResult>;
}
