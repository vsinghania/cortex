import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { AuthorizeMiddleware } from '../../common/middlewares/authorize.js';
import { AgentSvc } from '../../agent_svc/agent_svc.js';
import { MessageSchema } from '../../agent_svc/types/message.types.js';
import {
  agent_manifest_create_input_schema,
  agent_manifest_update_input_schema,
} from '../../agent_svc/types/agent_manifest.schema.js';

const AgentRunOptionsSchema = z.object({
  max_turns: z.number().int().positive().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  timeout_ms: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional(),
});

const RunRequestSchema = z.object({
  agent_id: z.string().min(1),
  input: z.union([z.string().min(1), z.array(MessageSchema).min(1)]),
  conversation_id: z.string().min(1).optional(),
  options: AgentRunOptionsSchema.optional(),
});

type RunRequest = z.infer<typeof RunRequestSchema>;
type CreateAgentRequest = z.infer<typeof agent_manifest_create_input_schema>;
type UpdateAgentRequest = z.infer<typeof agent_manifest_update_input_schema>;

const ListConversationsQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .pipe(z.number().int().positive().max(200))
    .optional(),
  before_updated_at: z
    .string()
    .datetime()
    .optional(),
});

const ConversationParamsSchema = z.object({
  conversation_id: z.string().min(1),
});

const AgentParamsSchema = z.object({
  agent_id: z.string().min(1),
});

export class AgentController {

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
    this.router.post(
      '/',
      AuthorizeMiddleware.authorizeRoles('admin'),
      this.createAgent.bind(this)
    );
    this.router.patch(
      '/:agent_id',
      AuthorizeMiddleware.authorizeRoles('admin'),
      this.updateAgent.bind(this)
    );
    this.router.post('/run', this.run.bind(this));
    this.router.get('/conversations', this.listConversations.bind(this));
    this.router.get('/conversations/:conversation_id', this.getConversation.bind(this));
    this.router.delete('/conversations/:conversation_id', this.deleteConversation.bind(this));
    // Registered after /conversations so '/:agent_id' cannot shadow it.
    this.router.get(
      '/',
      AuthorizeMiddleware.authorizeRoles('admin'),
      this.listAgents.bind(this)
    );
    this.router.get(
      '/:agent_id',
      AuthorizeMiddleware.authorizeRoles('admin'),
      this.getAgent.bind(this)
    );
  }

  @validateRequest({ body: agent_manifest_create_input_schema })
  private async createAgent(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const body = agent_manifest_create_input_schema.parse(req.body) as CreateAgentRequest;
      const agent_svc = await AgentSvc.create();
      const result = await agent_svc.createAgent(body);
      res.status(201).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: AgentParamsSchema, body: agent_manifest_update_input_schema })
  private async updateAgent(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const { agent_id } = req.params as { agent_id: string };
      const body = agent_manifest_update_input_schema.parse(req.body) as UpdateAgentRequest;
      const agent_svc = await AgentSvc.create();
      const result = await agent_svc.updateAgent({ agent_id, patch: body });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  private async listAgents(
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const agent_svc = await AgentSvc.create();
      const result = await agent_svc.listAgents();
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: AgentParamsSchema })
  private async getAgent(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const { agent_id } = req.params as { agent_id: string };
      const agent_svc = await AgentSvc.create();
      const result = await agent_svc.getAgent({ agent_id });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: RunRequestSchema })
  private async run(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const body = req.body as RunRequest;
      const user_id = req.auth!.user_id;
      const agent_svc = await AgentSvc.create();
      const result = await agent_svc.runByAgentId({
        agent_id: body.agent_id,
        input: body.input,
        conversation_id: body.conversation_id,
        user_id,
        options: body.options,
      });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ query: ListConversationsQuerySchema })
  private async listConversations(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const user_id = req.auth!.user_id;
      const limit_raw = (req.query as Record<string, unknown>).limit;
      const before_raw = (req.query as Record<string, unknown>).before_updated_at;
      const limit = typeof limit_raw === 'string' ? Number(limit_raw) : undefined;
      const before_updated_at = typeof before_raw === 'string' ? new Date(before_raw) : undefined;
      const agent_svc = await AgentSvc.create();
      const result = await agent_svc.listConversations({
        user_id,
        limit,
        before_updated_at,
      });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: ConversationParamsSchema })
  private async getConversation(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const { conversation_id } = req.params as { conversation_id: string };
      const user_id = req.auth!.user_id;
      const agent_svc = await AgentSvc.create();
      const result = await agent_svc.getConversation({ conversation_id, user_id });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: ConversationParamsSchema })
  private async deleteConversation(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const { conversation_id } = req.params as { conversation_id: string };
      const user_id = req.auth!.user_id;
      const agent_svc = await AgentSvc.create();
      await agent_svc.deleteConversation({ conversation_id, user_id });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  }
}
