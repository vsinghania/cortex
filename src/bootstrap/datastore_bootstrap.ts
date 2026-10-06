import { MongooseConnectionManager } from '../db/mongo/mongoose_connection_manager.js';
import { QdrantCollectionBootstrap } from '../db/qdrant/qdrant_collection_bootstrap.js';
import { EmbeddingsSvc } from '../embeddings_svc/embeddings_svc.js';
import { logger } from '../common/logger.js';

const NOTE_CHUNKS_COLLECTION = 'note_chunks_vec';

/** Datastore setup shared by every process that reads or writes notes. */
export class DatastoreBootstrap {
  private constructor() {}

  static async connectMongo(): Promise<void> {
    const host = process.env.MONGO_HOST ?? 'localhost';
    const mongo_port = Number(process.env.MONGO_PORT ?? 27017);
    try {
      await MongooseConnectionManager.getInstance({ host, port: mongo_port });
      logger.info({ host, port: mongo_port }, 'Mongo connected');
    } catch (e) {
      logger.error({ err: e, host, port: mongo_port }, 'Mongo bootstrap failed');
      throw e;
    }
  }

  static async disconnectMongo(): Promise<void> {
    const mgr = MongooseConnectionManager.getExistingInstance();
    if (mgr) await mgr.disconnectAll();
  }

  static async ensureQdrantCollection(): Promise<void> {
    try {
      const dim = EmbeddingsSvc.getInstance().dimensions;
      await QdrantCollectionBootstrap.ensureCollection({ name: NOTE_CHUNKS_COLLECTION, dim });
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        'Qdrant collection bootstrap failed; vectorization will be marked errored until Qdrant is reachable'
      );
    }
  }
}
