import express from 'express';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { VoiceSvc } from '../../voice_svc/voice_svc.js';

export class VoiceController {

  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    this.router.use(RequireAuthMiddleware.requireAuth);
    this.router.post('/session', this.mintSession.bind(this));
  }

  private async mintSession(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const user_id = req.auth!.user_id;
      const voice_svc = await VoiceSvc.getInstance();
      const result = await voice_svc.mintEphemeralVoiceToken({ user_id });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }
}
