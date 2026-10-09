import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { NoteFoldersSvc } from '../../notes_svc/note_folders_svc.js';
import { NoteFolderTree } from '../../notes_svc/note_folder_tree.js';

const FolderNameSchema = z.string().trim().min(1).max(NoteFolderTree.MAX_NAME_CHARS);

const FolderCreateBodySchema = z.object({
  name: FolderNameSchema,
  parent_id: z.string().min(1).nullable().optional()
}).strict();

const FolderPatchBodySchema = z.object({
  name: FolderNameSchema.optional(),
  parent_id: z.string().min(1).nullable().optional()
}).strict().refine((body) => body.name !== undefined || body.parent_id !== undefined, {
  message: 'Provide name and/or parent_id'
});

const FolderParamsSchema = z.object({
  folder_id: z.string().min(1)
});

/** Mounted by NotesController under /notes/folders, after its auth middleware. */
export class NoteFoldersController {

  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    this.router.get('/', this.listFolders.bind(this));
    this.router.post('/', this.createFolder.bind(this));
    this.router.patch('/:folder_id', this.updateFolder.bind(this));
    this.router.delete('/:folder_id', this.deleteFolder.bind(this));
  }

  private async listFolders(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const user_id = req.auth!.user_id;
      const folders_svc = await NoteFoldersSvc.create();
      const folders = await folders_svc.listFolderTree({ user_id });
      res.status(200).json({ response: { folders } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: FolderCreateBodySchema })
  private async createFolder(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const body = FolderCreateBodySchema.parse(req.body);
      const user_id = req.auth!.user_id;
      const folders_svc = await NoteFoldersSvc.create();
      const folder = await folders_svc.createFolder({ user_id, ...body });
      res.status(201).json({ response: { folder } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: FolderParamsSchema, body: FolderPatchBodySchema })
  private async updateFolder(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { folder_id } = FolderParamsSchema.parse(req.params);
      const body = FolderPatchBodySchema.parse(req.body);
      const user_id = req.auth!.user_id;
      const folders_svc = await NoteFoldersSvc.create();
      const folder = await folders_svc.updateFolder({ user_id, folder_id, ...body });
      res.status(200).json({ response: { folder } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ params: FolderParamsSchema })
  private async deleteFolder(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { folder_id } = FolderParamsSchema.parse(req.params);
      const user_id = req.auth!.user_id;
      const folders_svc = await NoteFoldersSvc.create();
      const result = await folders_svc.deleteFolder({ user_id, folder_id });
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }
}
