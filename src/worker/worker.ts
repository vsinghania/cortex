import 'dotenv/config';
import { DatastoreBootstrap } from '../bootstrap/datastore_bootstrap.js';
import { JobHandlerBootstrap } from '../bootstrap/job_handler_bootstrap.js';
import { JobWorker } from '../jobs_svc/worker/job_worker.js';
import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';

// Must stay inside the compose stop_grace_period (30s) with room for the worker's
// own 25s drain, so a wedged handler cannot hold the container past SIGKILL.
const FORCE_EXIT_MS = Time.secondsToMs(28);

/**
 * Runs queued jobs, apart from the API so a heavy re-index or sync never competes
 * with requests and either side deploys alone. Holds no singleton duties - the
 * schedule ticker stays in web-server - so it scales out by adding replicas.
 */
class WorkerServer {
  private static job_worker: JobWorker | null = null;
  private static shutting_down = false;

  private constructor() {}

  static async start(): Promise<void> {
    await DatastoreBootstrap.connectMongo();
    await DatastoreBootstrap.ensureQdrantCollection();
    await JobHandlerBootstrap.registerAll();

    // Unlike web-server, a worker that cannot work jobs has no reason to stay up:
    // failing the boot lets the restart policy and the deploy health gate see it.
    WorkerServer.job_worker = await JobWorker.create();
    WorkerServer.job_worker.start();

    process.on('SIGINT', WorkerServer.shutdown);
    process.on('SIGTERM', WorkerServer.shutdown);
  }

  private static async shutdown(signal: NodeJS.Signals): Promise<void> {
    if (WorkerServer.shutting_down) return;
    WorkerServer.shutting_down = true;
    logger.info({ signal }, 'Shutting down');

    const force_exit = setTimeout(() => {
      logger.error('Shutdown timed out; forcing exit');
      process.exit(1);
    }, FORCE_EXIT_MS);
    force_exit.unref?.();

    try {
      // Mongo closes last: the worker's drain needs it alive to flush checkpoints
      // and release leases.
      if (WorkerServer.job_worker) await WorkerServer.job_worker.stop();
      await DatastoreBootstrap.disconnectMongo();

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Shutdown failed');
      process.exit(1);
    }
  }
}

WorkerServer.start().catch((err: unknown) => {
  logger.error({ err }, 'Worker start failed');
  process.exit(1);
});
