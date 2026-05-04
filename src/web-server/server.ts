import 'dotenv/config';
import { App } from './app.js';
import { MongooseConnectionManager } from '../db/mongo/mongoose_connection_manager.js';
import { logger } from '../common/logger.js';

async function main() {
  const port = Number(process.env.PORT ?? 3000) || 3000;
  const app = new App();
  await app.initApp();

  const host = process.env.MONGO_HOST ?? 'localhost';
  const mongo_port = Number(process.env.MONGO_PORT ?? 27017);
  try {
    await MongooseConnectionManager.getInstance({ host, port: mongo_port });
    logger.info({ host, port: mongo_port }, 'Mongo connected');
  } catch (e) {
    logger.error({ err: e, host, port: mongo_port }, 'Mongo bootstrap failed');
    // continue starting server; health endpoint will show "down"
  }

  const server = app.getApp().listen(port, () => {
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
      server.close(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      });
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
