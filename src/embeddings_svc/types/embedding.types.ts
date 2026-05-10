export type EmbeddingVector = number[];

export type EmbeddingUsage = {
  prompt_tokens: number;
  total_tokens: number;
};

export type EmbedTextsResult = {
  vectors: EmbeddingVector[];
  model: string;
  usage: EmbeddingUsage;
};

export type EmbedQueryResult = {
  vector: EmbeddingVector;
  model: string;
  usage: EmbeddingUsage;
};
