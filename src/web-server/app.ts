import express from 'express';
import cors from 'cors';
import {pinoHttp} from 'pino-http';
import { ErrorHandlerMiddleware } from '../common/middlewares/error_handler.js'
import { nanoid } from 'nanoid';
import { logger } from '../common/logger.js';
import { AiController } from './ai/ai.controller.js';
import { QuizController } from './quiz/quiz.controller.js';
import { HealthController } from './health/health.controller.js';
import cookieParser from 'cookie-parser';
import { AuthController } from './auth/auth.controller.js';

export class App {

  private app: express.Express = express();

  async initApp() {
    // Enable CORS with credentials for refresh cookies
    const origins = process.env.CORS_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean);
    this.app.use(cors({ origin: origins && origins.length ? origins : true, credentials: true }));
    this.app.use(express.json());
    this.app.use(cookieParser());

    this.app.use((req, _res, next) => {
      // upsert a request id (prefer existing header if provided by gateway)
      (req as any).requestId = req.headers["x-request-id"] ?? nanoid();
      next();
    });

    this.app.use(
      pinoHttp({
        logger,
        autoLogging: true,
        customProps: (req) => ({ requestId: (req as any).requestId })
      })
    );

    this.app.get('/healthz', (_req, res) => res.send('ok'));

    this.registerRoutes();

    this.app.use(ErrorHandlerMiddleware.notFoundHandler);
    this.app.use(ErrorHandlerMiddleware.errorHandler);

    return;
  }

  getApp() {
    return this.app;
  }

  private registerRoutes() {
    const v1_router = express.Router();
    this.app.use('/api/v1', v1_router);
    this.registerV1Routers(v1_router);
  }

  private registerV1Routers(v1_router: express.Router) {
    // const user_controller = new UserController();
    // v1_router.use('/users', user_controller.getRouter());

    const auth_controller = new AuthController();
    v1_router.use('/auth', auth_controller.getRouter());

    const ai_controller = new AiController();
    v1_router.use('/ai', ai_controller.getRouter());

    const quiz_controller = new QuizController();
    v1_router.use('/quiz', quiz_controller.getRouter());

    const health_controller = new HealthController();
    v1_router.use('/health', health_controller.getRouter());
  }
}
