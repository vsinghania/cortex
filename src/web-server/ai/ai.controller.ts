import express from 'express';
import { z } from 'zod';
import { AiSvc } from '../../ai_svc/ai_svc.js';
import { GenAiProviderSchema, GenerateOptionsSchema, MessageSchema } from '../../ai_svc/types/ai_prompt.types.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';

const GenerateRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  provider: GenAiProviderSchema.optional(),
  options: GenerateOptionsSchema.optional(),
});

const GenerateStructuredRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  schema_name: z.string().min(1),
  provider: GenAiProviderSchema.optional(),
  options: GenerateOptionsSchema.optional(),
});

type GenerateRequestBody = z.infer<typeof GenerateRequestSchema>;
type GenerateStructuredRequestBody = z.infer<typeof GenerateStructuredRequestSchema>;

export class AiController {

  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter(): express.Router {
    return this.router;
  }

  private registerRoutes(): void {
    this.router.use(RequireAuthMiddleware.requireAuth);
    this.router.post('/generate', this.generate.bind(this));
    this.router.post('/generate-structured', this.generateStructured.bind(this));
  }

  @validateRequest({ body: GenerateRequestSchema })
  private async generate(req: express.Request, res: express.Response, _next: express.NextFunction): Promise<void> {
    const body = req.body as GenerateRequestBody;
    const ai_svc = await AiSvc.getInstance();
    const result = await ai_svc.generateText({
      messages: body.messages,
      provider: body.provider,
      options: body.options,
    });
    res.status(200).json(result);
  }

  @validateRequest({ body: GenerateStructuredRequestSchema })
  private async generateStructured(req: express.Request, res: express.Response, _next: express.NextFunction): Promise<void> {
    const body = req.body as GenerateStructuredRequestBody;
    const ai_svc = await AiSvc.getInstance();
    const result = await ai_svc.generateStructured({
      messages: body.messages,
      schema: { kind: 'registered', name: body.schema_name },
      provider: body.provider,
      options: body.options,
    });
    res.status(200).json(result);
  }
}
