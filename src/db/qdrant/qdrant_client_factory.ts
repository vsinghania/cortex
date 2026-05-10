import { QdrantClient } from '@qdrant/js-client-rest';

export class QdrantClientFactory {
  private static instance: QdrantClient | null = null;

  private constructor() {}

  static getInstance(): QdrantClient {
    if (QdrantClientFactory.instance) return QdrantClientFactory.instance;
    const url = process.env.QDRANT_URL ?? 'http://localhost:6333';
    const api_key = process.env.QDRANT_API_KEY?.trim();
    QdrantClientFactory.instance = new QdrantClient({
      url,
      ...(api_key ? { apiKey: api_key } : {})
    });
    return QdrantClientFactory.instance;
  }

  static resetForTests(): void {
    QdrantClientFactory.instance = null;
  }
}
