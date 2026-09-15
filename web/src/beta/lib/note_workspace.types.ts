import type { NoteFolderNode } from '../../lib/note_folder.types';

export type NoteSortMode = 'recent' | 'az';

/** The notes list selection, mirrored one-to-one in the URL's search params. */
export type NoteFilters = {
  /** A folder id, NoteFilterParams.UNFILED, or null for every folder. */
  folder: string | null;
  archived: boolean;
  tag: string | null;
  q: string;
  sort: NoteSortMode;
};

export type FolderTreeNode = NoteFolderNode & {
  children: FolderTreeNode[];
  depth: number;
};

export type OutlineHeading = {
  /** 1-based source line, matching react-markdown's node positions. */
  line: number;
  level: 1 | 2 | 3;
  text: string;
};

/** A request from the outline to bring a heading into view; `nonce` lets the same heading be asked for twice. */
export type OutlineRequest = {
  line: number;
  nonce: number;
};

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export type NoteDraftFields = {
  title: string;
  body: string;
};
