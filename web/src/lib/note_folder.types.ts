/** Mirrors NoteFolderNode in src/notes_svc/types/note_folder.types.ts. */
export type NoteFolderNode = {
  id: string;
  name: string;
  parent_id: string | null;
  ancestor_ids: string[];
  /** Folder names from the top level down to and including this folder. */
  path: string[];
  /** Non-archived notes filed directly in this folder, not in its subfolders. */
  note_count: number;
  created_at: string;
  updated_at: string;
};

export type NoteFolderCreateBody = {
  name: string;
  parent_id?: string | null;
};

export type NoteFolderPatchBody = {
  name?: string;
  parent_id?: string | null;
};

/** Mirrors NoteFolderDeleteResult; folder deletes cascade to subfolders and their notes. */
export type NoteFolderDeleteResult = {
  folders_deleted: number;
  notes_deleted: number;
};
