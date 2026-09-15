import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { NotesSvc, type NoteListFilter } from '../../notes_svc/notes_svc.js';
import { NoteListSort } from '../../notes_svc/note_list_sort.js';
import { NotFoundError } from '../../common/errors.js';
import type { NoteContainer } from '../../notes_svc/types/note.types.js';
import type { NoteChunk, NoteChunkRef } from '../../notes_svc/types/note_chunk.types.js';

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
  is_archived: z.boolean().optional(),
  is_pinned: z.boolean().optional()
}).strict();

const MAX_TAG_FILTER_COUNT = 10;

// Repeated query params (?tags=a&tags=b) arrive as a bare string when there is exactly
// one, so both forms normalize to an array here.
const NoteTagsQuerySchema = z
  .union([z.string().min(1), z.array(z.string().min(1))])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .pipe(z.array(z.string()).min(1).max(MAX_TAG_FILTER_COUNT));

const BooleanQuerySchema = z.enum(['true', 'false']).transform((v) => v === 'true');

const NoteListQuerySchema = z.object({
  q: z.string().optional(),
  tags: NoteTagsQuerySchema.optional(),
  archived: z.enum(['exclude', 'only', 'include']).optional(),
  pinned: BooleanQuerySchema.optional(),
  sort: z.enum(NoteListSort.FIELDS).optional(),
  order: z.enum(NoteListSort.ORDERS).optional(),
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

const NoteTagsListQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .pipe(z.number().int().positive().max(200))
    .optional()
});

const NoteParamsSchema = z.object({
  id: z.string().min(1)
});

const NoteChunkParamsSchema = z.object({
  id: z.string().min(1),
  chunk_id: z.string().min(1)
});

type NoteCreateBody = z.infer<typeof NoteCreateBodySchema>;
type NotePatchBody = z.infer<typeof NotePatchBodySchema>;
type NoteListQuery = z.infer<typeof NoteListQuerySchema>;

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
    // Must precede '/:id', or this resolves to getNote with id='tags'.
    this.router.get('/tags', this.listTags.bind(this));
    this.router.get('/:id/chunks/:chunk_id', this.getNoteChunk.bind(this));
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
      const query = NoteListQuerySchema.parse(req.query);
      const notes_svc = await NotesSvc.create();
      const result = await notes_svc.listNotes({
        user_id,
        query: query.q,
        filter: NotesController.toListFilter(query),
        sort: NoteListSort.fromParts({ field: query.sort, order: query.order }),
        limit: query.limit,
        offset: query.offset
      });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  private static toListFilter(query: NoteListQuery): NoteListFilter {
    return {
      tags: query.tags,
      archived: query.archived,
      pinned: query.pinned
    };
  }

  @validateRequest({ query: NoteTagsListQuerySchema })
  private async listTags(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const user_id = req.auth!.user_id;
      const query_raw = req.query as Record<string, unknown>;
      const limit = typeof query_raw.limit === 'string' ? Number(query_raw.limit) : undefined;
      const notes_svc = await NotesSvc.create();
      const tags = await notes_svc.listTags({ user_id, limit });
      res.status(200).json({ response: { tags } });
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

  @validateRequest({ params: NoteChunkParamsSchema })
  private async getNoteChunk(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { id, chunk_id } = req.params as { id: string; chunk_id: string };
      const user_id = req.auth!.user_id;
      const notes_svc = await NotesSvc.create();
      const chunk = await notes_svc.getChunk({ user_id, note_id: id, chunk_id });
      if (!chunk) throw new NotFoundError('Note chunk not found');
      res.status(200).json({ response: { chunk: NotesController.toChunkRef(chunk) } });
    } catch (e) {
      next(e);
    }
  }

  /** Trims embedding bookkeeping (hash, vectorization) off the wire shape. */
  private static toChunkRef(chunk: NoteChunk): NoteChunkRef {
    return {
      id: chunk.id,
      note_id: chunk.note_id,
      chunk_index: chunk.chunk_index,
      heading_path: chunk.heading_path,
      start_offset: chunk.start_offset,
      end_offset: chunk.end_offset,
      content: chunk.content
    };
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
