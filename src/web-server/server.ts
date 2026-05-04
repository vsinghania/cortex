import 'dotenv/config';
import { App } from './app.js';
import { MongooseConnectionManager } from '../db/mongo/mongoose_connection_manager.js';
import { AgentSvc } from '../agent_svc/agent_svc.js';
import { logger } from '../common/logger.js';

class Server {
  private constructor() {}

  static async start(): Promise<void> {
    const port = Number(process.env.PORT ?? 3000) || 3000;
    const app = new App();
    app.initApp();

    await Server.initDependencies();

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
    await Server.loadAgentSvc();
  }

  private static async connectMongo(): Promise<void> {
    const host = process.env.MONGO_HOST ?? 'localhost';
    const mongo_port = Number(process.env.MONGO_PORT ?? 27017);
    try {
      await MongooseConnectionManager.getInstance({ host, port: mongo_port });
      logger.info({ host, port: mongo_port }, 'Mongo connected');
    } catch (e) {
      logger.error({ err: e, host, port: mongo_port }, 'Mongo bootstrap failed');
      // continue starting server; health endpoint will show "down"
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

Server.start();
