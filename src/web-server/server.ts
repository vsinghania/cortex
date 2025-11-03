import 'dotenv/config';
import { App } from './app.js';
import { MongooseConnectionManager } from '../db/mongo/mongoose_connection_manager.js';

async function main() {
  const port = Number(process.env.PORT ?? 3000) || 3000;
  const app = new App();
  await app.initApp();

  const host = process.env.MONGO_HOST ?? 'localhost';
  const mongo_port = Number(process.env.MONGO_PORT ?? 27017);
  try {
    await MongooseConnectionManager.getInstance({ host, port: mongo_port });
  } catch (e) {
    console.error('Mongo bootstrap failed', e);
    // continue starting server; health endpoint will show "down"
  }

  const server = app.getApp().listen(port, () => {
    console.log(`🚀 http://localhost:${port}`);
  });

  const shutdown = async () => {
    try {
      const mgr = MongooseConnectionManager.getExistingInstance();
      if (mgr) {
        await mgr.disconnectAll();
      }
    } finally {
      server.close(() => process.exit(0));
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
