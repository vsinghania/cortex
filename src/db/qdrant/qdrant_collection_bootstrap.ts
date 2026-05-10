import { QdrantClientFactory } from './qdrant_client_factory.js';
import { logger } from '../../common/logger.js';

export type EnsureCollectionParams = {
  name: string;
  dim: number;
  distance?: 'Cosine' | 'Dot' | 'Euclid';
};

export class QdrantCollectionBootstrap {

  private constructor() {}

  static async ensureCollection(params: EnsureCollectionParams): Promise<void> {
    const client = QdrantClientFactory.getInstance();
    const distance = params.distance ?? 'Cosine';

    const exists_res = await client.collectionExists(params.name);
    if (exists_res.exists) {
      logger.debug(
        { collection: params.name, dim: params.dim },
        'Qdrant collection already exists'
      );
      return;
    }

    await client.createCollection(params.name, {
      vectors: { size: params.dim, distance }
    });

    await QdrantCollectionBootstrap.ensureUserIdIndex(params.name);

    logger.info(
      { collection: params.name, dim: params.dim, distance },
      'Qdrant collection created'
    );
  }

  private static async ensureUserIdIndex(collection_name: string): Promise<void> {
    const client = QdrantClientFactory.getInstance();
    try {
      await client.createPayloadIndex(collection_name, {
        field_name: 'user_id',
        field_schema: 'keyword'
      });
      logger.debug({ collection: collection_name, field: 'user_id' }, 'Qdrant payload index created');
    } catch (err) {
      logger.warn(
        { err, collection: collection_name, field: 'user_id' },
        'failed to create user_id payload index; filtered search may be slower'
      );
    }
  }
}
