import type { NoteFolder } from '../types/note_folder.types.js';
import type { NoteSource } from '../types/note.types.js';

export type NoteFolderProviderKey = {
  user_id: string;
  source: NoteSource;
  external_id: string;
};

export type NoteFolderKey = {
  user_id: string;
  id: string;
};

export type NoteFolderPlacement = {
  parent_id: string | null;
  ancestor_ids: string[];
};

/** Name-uniqueness among siblings is case-insensitive; violations throw NoteFolderNameTakenError. */
export interface NoteFolderRepository {
  createFolder(folder: NoteFolder): Promise<NoteFolder>;

  getFolder(params: NoteFolderKey): Promise<NoteFolder | null>;
  findChildByName(params: { user_id: string; parent_id: string | null; name: string }): Promise<NoteFolder | null>;
  /** The folder a provider container maps to, regardless of what it has since been renamed to. */
  findByProviderKey(params: NoteFolderProviderKey): Promise<NoteFolder | null>;
  listFolders(params: { user_id: string }): Promise<NoteFolder[]>;
  listDescendants(params: NoteFolderKey): Promise<NoteFolder[]>;

  updateFolderDetails(params: NoteFolderKey & { name?: string; description?: string }): Promise<NoteFolder | null>;

  /** Re-parents a folder and rewrites the ancestor chain of everything beneath it. */
  moveFolder(params: { folder: NoteFolder; placement: NoteFolderPlacement }): Promise<NoteFolder | null>;

  deleteFolders(params: { user_id: string; ids: string[] }): Promise<number>;
}
