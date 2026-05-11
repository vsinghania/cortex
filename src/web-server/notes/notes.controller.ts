import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { NotesSvc } from '../../notes_svc/notes_svc.js';
import { NotFoundError } from '../../common/errors.js';
import type { NoteContainer } from '../../notes_svc/types/note.types.js';

const NoteContainerSchema: z.ZodType<NoteContainer> = z.object({
  container_type: z.enum(['notebook', 'database', 'folder', 'page', 'section', 'collection', 'other']),
  container_id: z.string().min(1),
  container_name: z.string().min(1).optional()
});

const NoteCreateBodySchema = z.object({
  title: z.string().min(1),
  body: z.string().default(''),
  body_raw: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: NoteContainerSchema.optional()
}).strict();

const NotePatchBodySchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  body_raw: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: NoteContainerSchema.optional(),
  is_archived: z.boolean().optional()
}).strict();

const NoteListQuerySchema = z.object({
  q: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .pipe(z.number().int().positive().max(100))
    .optional(),
  offset: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .pipe(z.number().int().nonnegative())
    .optional()
});

const NoteParamsSchema = z.object({
  id: z.string().min(1)
});

type NoteCreateBody = z.infer<typeof NoteCreateBodySchema>;
type NotePatchBody = z.infer<typeof NotePatchBodySchema>;

export class NotesController {

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
    this.router.post('/', this.createNote.bind(this));
    this.router.get('/', this.listNotes.bind(this));
    this.router.get('/:id', this.getNote.bind(this));
    this.router.patch('/:id', this.updateNote.bind(this));
    this.router.delete('/:id', this.deleteNote.bind(this));
  }

  @validateRequest({ body: NoteCreateBodySchema })
  private async createNote(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const body = req.body as NoteCreateBody;
      const user_id = req.auth!.user_id;
      const notes_svc = await NotesSvc.create();
      const note = await notes_svc.createNote({ user_id, ...body });
      res.status(201).json({ response: { note } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ query: NoteListQuerySchema })
  private async listNotes(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const user_id = req.auth!.user_id;
      const query_raw = req.query as Record<string, unknown>;
      const q = typeof query_raw.q === 'string' ? query_raw.q : undefined;
      const limit = typeof query_raw.limit === 'string' ? Number(query_raw.limit) : undefined;
      const offset = typeof query_raw.offset === 'string' ? Number(query_raw.offset) : undefined;
      const notes_svc = await NotesSvc.create();
      const result = await notes_svc.listNotes({ user_id, query: q, limit, offset });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: NoteParamsSchema })
  private async getNote(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { id } = req.params as { id: string };
      const user_id = req.auth!.user_id;
      const notes_svc = await NotesSvc.create();
      const note = await notes_svc.getNote(user_id, { id });
      if (!note) throw new NotFoundError('Note not found');
      res.status(200).json({ response: { note } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: NoteParamsSchema, body: NotePatchBodySchema })
  private async updateNote(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { id } = req.params as { id: string };
      const user_id = req.auth!.user_id;
      const patch = req.body as NotePatchBody;
      const notes_svc = await NotesSvc.create();
      const note = await notes_svc.updateNote(user_id, { id }, patch);
      if (!note) throw new NotFoundError('Note not found');
      res.status(200).json({ response: { note } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: NoteParamsSchema })
  private async deleteNote(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { id } = req.params as { id: string };
      const user_id = req.auth!.user_id;
      const notes_svc = await NotesSvc.create();
      const success = await notes_svc.deleteNote(user_id, { id });
      if (!success) throw new NotFoundError('Note not found');
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  }
}
