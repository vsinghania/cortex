import 'dotenv/config';
import { App } from './app.js';
import { AgentSvc } from '../agent_svc/agent_svc.js';
import { AiSvc } from '../ai_svc/ai_svc.js';
import { RetrievalSvc } from '../retrieval_svc/retrieval_svc.js';
import { DatastoreBootstrap } from '../bootstrap/datastore_bootstrap.js';
import { JobHandlerBootstrap } from '../bootstrap/job_handler_bootstrap.js';
import { ContextDocumentResolverBootstrap } from './bootstrap/context_document_resolver_bootstrap.js';
import { JobScheduler } from '../jobs_svc/job_scheduler.js';
import { JobWorkerConfigLoader } from '../jobs_svc/worker/job_worker_config.js';
import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';

// Must stay inside the compose stop_grace_period (30s), so in-flight requests -
// streamed agent replies especially - get a chance to finish before SIGKILL.
const FORCE_EXIT_MS = Time.secondsToMs(28);

class Server {
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
        await new Promise<void>((resolve) => http_server.close(() => resolve()));
        Server.job_scheduler?.stop();
        await DatastoreBootstrap.disconnectMongo();

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
    await DatastoreBootstrap.connectMongo();
    await DatastoreBootstrap.ensureQdrantCollection();
    await Server.bootstrapRetrievalSvc();
    ContextDocumentResolverBootstrap.registerAll();
    await Server.loadAgentSvc();
    await Server.loadAiSvc();
    // Jobs run in the worker service; registered here so the admin API and the
    // scheduler can validate job names and payloads before enqueueing them.
    await JobHandlerBootstrap.registerAll();
    await Server.startJobScheduler();
  }

  /**
   * Starts the ticker only - it enqueues, the worker service runs. It lives here
   * rather than in the worker so scaling workers out never multiplies tickers.
   * Schedules themselves are data, created and removed through
   * /api/v1/admin/jobs/schedules - deliberately NOT seeded here, because a
   * boot-time upsert would recreate anything an operator had deleted, so the API
   * could add a schedule but never durably remove one.
   */
  private static async startJobScheduler(): Promise<void> {
    if (!JobWorkerConfigLoader.fromEnv().scheduler_enabled) {
      logger.info('Job scheduler disabled for this process');
      return;
    }
    try {
      const scheduler = await JobScheduler.create();
      scheduler.start();
      Server.job_scheduler = scheduler;
    } catch (err) {
      logger.error({ err }, 'Job scheduler failed to start; recurring jobs will not fire');
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
