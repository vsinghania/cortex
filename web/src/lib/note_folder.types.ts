/** Mirrors NoteFolderNode in src/notes_svc/types/note_folder.types.ts. */
export type NoteFolderNode = {
  id: string;
  name: string;
  description?: string;
  parent_id: string | null;
  ancestor_ids: string[];
  /** Folder names from the top level down to and including this folder. */
  path: string[];
  /** Non-archived notes filed directly in this folder, not in its subfolders. */
  note_count: number;
  /**
   * Set on folders a provider sync owns. Renaming or moving one is undone by the next
   * pass, which rebuilds the tree from the provider — so the UI says whose folder it is.
   */
  source?: string;
  container_type?: 'notebook' | 'section_group' | 'section';
  created_at: string;
  updated_at: string;
};

export type NoteFolderCreateBody = {
  name: string;
  description?: string;
  parent_id?: string | null;
};

export type NoteFolderPatchBody = {
  name?: string;
  description?: string;
  parent_id?: string | null;
};

/** Mirrors NoteFolderDeleteResult; folder deletes cascade to subfolders and their notes. */
export type NoteFolderDeleteResult = {
  folders_deleted: number;
  notes_deleted: number;
};
