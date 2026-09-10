import 'dotenv/config';
import { App } from './app.js';
import { MongooseConnectionManager } from '../db/mongo/mongoose_connection_manager.js';
import { QdrantCollectionBootstrap } from '../db/qdrant/qdrant_collection_bootstrap.js';
import { AgentSvc } from '../agent_svc/agent_svc.js';
import { AiSvc } from '../ai_svc/ai_svc.js';
import { NotesRecallAgentSeed } from '../agent_svc/seeds/notes_recall_agent_seed.js';
import { EmbeddingsSvc } from '../embeddings_svc/embeddings_svc.js';
import { RetrievalSvc } from '../retrieval_svc/retrieval_svc.js';
import { JobHandlerRegistry } from '../jobs_svc/handlers/job_handler_registry.js';
import { JobWorker } from '../jobs_svc/worker/job_worker.js';
import { JobWorkerConfigLoader } from '../jobs_svc/worker/job_worker_config.js';
import { NotesReindexHandler } from '../notes_svc/jobs/notes_reindex_handler.js';
import { RefreshTokenPruneHandler } from '../auth_svc/jobs/refresh_token_prune_handler.js';
import { AuthJobName } from '../auth_svc/jobs/auth_job.types.js';
import { JobScheduler } from '../jobs_svc/job_scheduler.js';
import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';

// Must stay inside the compose stop_grace_period (30s) with room for the worker's
// own 25s drain, so a wedged handler cannot hold the container past SIGKILL.
const FORCE_EXIT_MS = Time.secondsToMs(28);

class Server {
  private static job_worker: JobWorker | null = null;
  private static job_scheduler: JobScheduler | null = null;

  private constructor() {}

  static async start(): Promise<void> {
    const port = Number(process.env.PORT ?? 3000) || 3000;

    await Server.initDependencies();

    const app = new App();
    app.initApp();

    const http_server = app.getApp().listen(port, () => {
      logger.info({ port }, 'HTTP server listening');
    });

    let shutting_down = false;
    const shutdown = async (signal: NodeJS.Signals) => {
      if (shutting_down) return;
      shutting_down = true;
      logger.info({ signal }, 'Shutting down');

      const force_exit = setTimeout(() => {
        logger.error('Shutdown timed out; forcing exit');
        process.exit(1);
      }, FORCE_EXIT_MS);
      force_exit.unref?.();

      try {
        // Order matters: stop accepting, then drain in-flight work, and only then
        // close Mongo - the worker's drain needs the database alive to flush
        // checkpoints and release leases.
        await new Promise<void>((resolve) => http_server.close(() => resolve()));
        Server.job_scheduler?.stop();
        if (Server.job_worker) await Server.job_worker.stop();

        const mgr = MongooseConnectionManager.getExistingInstance();
        if (mgr) await mgr.disconnectAll();

        logger.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Shutdown failed');
        process.exit(1);
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
    await Server.registerJobHandlers();
    await Server.startJobWorker();
    await Server.startJobScheduler();
  }

  /**
   * Rethrows, unlike most steps here: a handler that silently fails to register
   * means its jobs are claimed and released unrun on a loop, which looks like a
   * healthy worker and an inexplicably stuck queue.
   */
  private static async registerJobHandlers(): Promise<void> {
    const registry = JobHandlerRegistry.getInstance();
    registry.register(await NotesReindexHandler.create());
    registry.register(await RefreshTokenPruneHandler.create());
    logger.info({ job_names: registry.registeredNames() }, 'Job handlers registered');
  }

  /**
   * Schedules are data, so registering them at boot is an upsert on a stable id -
   * idempotent across restarts, and the source of truth stays in code rather than
   * in whatever someone once inserted by hand.
   */
  private static async startJobScheduler(): Promise<void> {
    if (!JobWorkerConfigLoader.fromEnv().scheduler_enabled) {
      logger.info('Job scheduler disabled for this process');
      return;
    }
    try {
      const scheduler = await JobScheduler.create();
      await scheduler.upsertSchedule({
        id: 'refresh-token-prune-daily',
        name: AuthJobName.RefreshTokenPrune,
        label: 'Prune expired refresh sessions',
        payload: {},
        schedule: { kind: 'cron', expression: '0 3 * * *', timezone: 'UTC' },
        dedup_key: AuthJobName.RefreshTokenPrune,
        // Housekeeping: a missed night should still run, so catch up.
        catchup: true
      });
      scheduler.start();
      Server.job_scheduler = scheduler;
    } catch (err) {
      logger.error({ err }, 'Job scheduler failed to start; recurring jobs will not fire');
    }
  }

  private static async startJobWorker(): Promise<void> {
    if (!JobWorkerConfigLoader.fromEnv().enabled) {
      logger.info('Job worker disabled; this process will enqueue only');
      return;
    }
    try {
      Server.job_worker = await JobWorker.create();
      Server.job_worker.start();
    } catch (err) {
      logger.error({ err }, 'Job worker failed to start; queued jobs will not run');
    }
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
