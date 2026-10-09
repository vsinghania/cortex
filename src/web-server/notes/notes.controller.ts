import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { NotesSvc, type NoteListFilter } from '../../notes_svc/notes_svc.js';
import { NoteListSort } from '../../notes_svc/note_list_sort.js';
import { NoteBulkActionMapper } from '../../notes_svc/note_bulk_action_mapper.js';
import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import { NoteFoldersController } from './note_folders.controller.js';
import { NoteSource } from '../../notes_svc/types/note.types.js';
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
  container: NoteContainerSchema.optional(),
  folder_id: z.string().min(1).optional()
}).strict();

const NotePatchBodySchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  body_raw: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: NoteContainerSchema.optional(),
  folder_id: z.string().min(1).nullable().optional(),
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

/** `folder_id=none` lists unfiled notes. */
const UNFILED_FOLDER_QUERY_VALUE = 'none';

const NoteListQuerySchema = z.object({
  q: z.string().optional(),
  tags: NoteTagsQuerySchema.optional(),
  archived: z.enum(['exclude', 'only', 'include']).optional(),
  pinned: BooleanQuerySchema.optional(),
  folder_id: z.string().min(1).optional(),
  include_subfolders: BooleanQuerySchema.optional(),
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

const NoteTagParamsSchema = z.object({
  tag: z.string().trim().min(1)
});

const NoteFilingSuggestionBodySchema = z.object({
  title: z.string().optional(),
  body: z.string().default('')
}).strict().refine((b) => (b.title ?? '').trim().length > 0 || b.body.trim().length > 0, {
  message: 'Provide a non-blank title or body'
});

const NoteBulkIdsSchema = z.array(z.string().min(1)).min(1).max(NoteBulkActionMapper.MAX_IDS);
const NoteBulkTagsSchema = z.array(z.string().trim().min(1)).min(1).max(MAX_TAG_FILTER_COUNT);

const NoteBulkBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move'), ids: NoteBulkIdsSchema, folder_id: z.string().min(1).nullable() }).strict(),
  z.object({ action: z.literal('archive'), ids: NoteBulkIdsSchema }).strict(),
  z.object({ action: z.literal('unarchive'), ids: NoteBulkIdsSchema }).strict(),
  z.object({ action: z.literal('pin'), ids: NoteBulkIdsSchema }).strict(),
  z.object({ action: z.literal('unpin'), ids: NoteBulkIdsSchema }).strict(),
  z.object({ action: z.literal('add_tags'), ids: NoteBulkIdsSchema, tags: NoteBulkTagsSchema }).strict(),
  z.object({ action: z.literal('remove_tags'), ids: NoteBulkIdsSchema, tags: NoteBulkTagsSchema }).strict(),
  z.object({ action: z.literal('delete'), ids: NoteBulkIdsSchema }).strict()
]);

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
    // Must precede '/:id', or these resolve to getNote with id='tags' / id='folders'.
    this.router.get('/tags', this.listTags.bind(this));
    this.router.delete('/tags/:tag', this.deleteTag.bind(this));
    this.router.use('/folders', new NoteFoldersController().getRouter());
    this.router.post('/bulk', this.bulkUpdateNotes.bind(this));
    this.router.post('/filing_suggestion', this.suggestFiling.bind(this));
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
      // Editor clients autosave; deferring the embed keeps each save fast and coalesces bursts.
      const note = await notes_svc.createNote({ user_id, ...body }, { indexing: 'deferred' });
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
        sort: NoteListSort.fromFieldAndOrder({ field: query.sort, order: query.order }),
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
      pinned: query.pinned,
      folder: query.folder_id
        ? {
            folder_id: query.folder_id === UNFILED_FOLDER_QUERY_VALUE ? null : query.folder_id,
            include_subfolders: query.include_subfolders
          }
        : undefined
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

  @validateRequest({ params: NoteTagParamsSchema })
  private async deleteTag(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { tag } = NoteTagParamsSchema.parse(req.params);
      const user_id = req.auth!.user_id;
      const notes_svc = await NotesSvc.create();
      const notes_updated = await notes_svc.deleteTag({ user_id, tag });
      if (notes_updated === 0) throw new NotFoundError('Tag not found');
      res.status(200).json({ response: { tag, notes_updated } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: NoteBulkBodySchema })
  private async bulkUpdateNotes(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { ids, ...action } = NoteBulkBodySchema.parse(req.body);
      const user_id = req.auth!.user_id;
      const notes_svc = await NotesSvc.create();
      const result = await notes_svc.bulkUpdate({ user_id, ids, action });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: NoteFilingSuggestionBodySchema })
  private async suggestFiling(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const body = NoteFilingSuggestionBodySchema.parse(req.body);
      const user_id = req.auth!.user_id;
      const notes_svc = await NotesSvc.create();
      const suggestion = await notes_svc.suggestNoteFiling({ user_id, ...body });
      res.status(200).json({ response: { suggestion } });
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

  /**
   * A note that mirrors a provider is read-only here: its body is overwritten wholesale
   * by the next sync, so accepting an edit would be promising to keep something we are
   * about to discard. Organising it - tags, pin, archive, which the sync never writes -
   * stays allowed.
   *
   * Enforced at this boundary rather than in NotesSvc, which the sync itself calls.
   */
  private static async assertEditable(args: {
    notes_svc: NotesSvc;
    user_id: string;
    id: string;
    patch: NotePatchBody;
  }): Promise<void> {
    const touches_content = args.patch.title !== undefined || args.patch.body !== undefined;
    if (!touches_content) return;

    const note = await args.notes_svc.getNote(args.user_id, { id: args.id });
    if (!note) throw new NotFoundError('Note not found');
    if (note.source === NoteSource.Native) return;

    throw new ForbiddenError(`This note is synced from ${note.source} and can only be edited there`);
  }

  @validateRequest({ params: NoteParamsSchema, body: NotePatchBodySchema })
  private async updateNote(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { id } = req.params as { id: string };
      const user_id = req.auth!.user_id;
      const patch = req.body as NotePatchBody;
      const notes_svc = await NotesSvc.create();
      await NotesController.assertEditable({ notes_svc, user_id, id, patch });

      const note = await notes_svc.updateNote(user_id, { id }, patch, { indexing: 'deferred' });
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
