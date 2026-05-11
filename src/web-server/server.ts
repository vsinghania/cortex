import 'dotenv/config';
import { App } from './app.js';
import { MongooseConnectionManager } from '../db/mongo/mongoose_connection_manager.js';
import { QdrantCollectionBootstrap } from '../db/qdrant/qdrant_collection_bootstrap.js';
import { AgentSvc } from '../agent_svc/agent_svc.js';
import { AiSvc } from '../ai_svc/ai_svc.js';
import { NotesRecallAgentSeed } from '../agent_svc/seeds/notes_recall_agent_seed.js';
import { EmbeddingsSvc } from '../embeddings_svc/embeddings_svc.js';
import { RetrievalSvc } from '../retrieval_svc/retrieval_svc.js';
import { logger } from '../common/logger.js';

class Server {
  private constructor() {}

  static async start(): Promise<void> {
    const port = Number(process.env.PORT ?? 3000) || 3000;

    await Server.initDependencies();

    const app = new App();
    app.initApp();

    const http_server = app.getApp().listen(port, () => {
      logger.info({ port }, 'HTTP server listening');
    });

    const shutdown = async (signal: NodeJS.Signals) => {
      logger.info({ signal }, 'Shutting down');
      try {
        const mgr = MongooseConnectionManager.getExistingInstance();
        if (mgr) {
          await mgr.disconnectAll();
        }
      } finally {
        http_server.close(() => {
          logger.info('Shutdown complete');
          process.exit(0);
        });
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  private static async initDependencies(): Promise<void> {
    await Server.connectMongo();
    await Server.bootstrapQdrant();
    await Server.bootstrapRetrievalSvc();
    await Server.seedNotesRecallAgent();
    await Server.loadAgentSvc();
    await Server.loadAiSvc();
  }

  private static async loadAiSvc(): Promise<void> {
    await AiSvc.getInstance();
    logger.info('AiSvc loaded');
  }

  private static async bootstrapRetrievalSvc(): Promise<void> {
    try {
      await RetrievalSvc.create();
    } catch (err) {
      logger.warn({ err }, 'RetrievalSvc bootstrap failed; semantic search will error until resolved');
    }
  }

  private static async connectMongo(): Promise<void> {
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

  private static async bootstrapQdrant(): Promise<void> {
    try {
      const dim = EmbeddingsSvc.getInstance().dimensions;
      await QdrantCollectionBootstrap.ensureCollection({ name: 'note_chunks_vec', dim });
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        'Qdrant collection bootstrap failed; vectorization will be marked errored until Qdrant is reachable'
      );
    }
  }

  private static async seedNotesRecallAgent(): Promise<void> {
    try {
      await NotesRecallAgentSeed.ensure();
    } catch (err) {
      logger.warn({ err }, 'notes-recall agent seed failed; chat agent may be missing');
    }
  }

  private static async loadAgentSvc(): Promise<void> {
    try {
      await AgentSvc.create();
      logger.info('AgentSvc loaded');
    } catch (e) {
      logger.error({ err: e }, 'AgentSvc load failed; will retry on first request');
    }
  }
}

Server.start().catch((err: unknown) => {
  logger.error({ err }, 'Server start failed');
  process.exit(1);
});
