export interface NoteFolder {
  id: string; // domain ID (UUID v7)
  user_id: string; // domain ID (UUID)
  name: string;
  parent_id: string | null; // null = top level
  /** Root-first ids of every ancestor, so a whole subtree is one indexed match. */
  ancestor_ids: string[];
  created_at: Date;
  updated_at: Date;
}

export type NoteFolderNode = NoteFolder & {
  /** Folder names from the top level down to and including this folder. */
  path: string[];
  /** Non-archived notes filed directly in this folder. */
  note_count: number;
};

export type NoteFolderDeleteResult = {
  folders_deleted: number;
  notes_deleted: number;
};
