import express from 'express';
import { logger } from '../../common/logger.js';
import { AiSvc } from '../../ai_svc/ai_svc.js';
import { HttpError, BadRequestError } from '../../common/errors.js';

export class AiController {

  private readonly router: express.Router;
  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    this.router.post('/basic-prompt', this.basicPrompt);
  }

  private basicPrompt = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const { prompt, message_history } = req.body;
      if (!prompt) {
        throw new BadRequestError('Prompt is required');
      }
      const ai_svc = new AiSvc();
      const resp_text = await ai_svc.sendBasicPrompt(prompt, message_history);
      res.status(200).json({ response: resp_text });
    } catch (e) {
      next(e);
    }
  }
}
