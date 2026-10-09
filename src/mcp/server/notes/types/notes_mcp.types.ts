import type { z } from 'zod';
import type { zListInput, zBulkUpdateInput } from '../notes_mcp_schemas.js';
import type { NotesSvc } from '../../../../notes_svc/notes_svc.js';
import type { NoteFoldersSvc } from '../../../../notes_svc/note_folders_svc.js';
import type { NoteLinks } from '../note_links.js';

export type NotesMcpServices = {
  readonly notes_svc: Pick<NotesSvc,
    'listNotes' | 'listTags' | 'getNote' | 'createNote' | 'updateNote' | 'deleteNote' |
    'bulkUpdate' | 'searchNotes' | 'retrieveChunks'>;
  readonly folders_svc: Pick<NoteFoldersSvc, 'listFolderTree' | 'ensureFolderPath'>;
  readonly links: NoteLinks | null;
};

export type NotesMcpListInput = z.infer<typeof zListInput>;
export type NotesMcpBulkUpdateInput = z.infer<typeof zBulkUpdateInput>;
