import { z } from 'zod';
import { NoteSource, type NoteLocator } from '../../../notes_svc/types/note.types.js';
import { NoteListSort } from '../../../notes_svc/note_list_sort.js';
import { NoteBulkActionMapper } from '../../../notes_svc/note_bulk_action_mapper.js';
import { NoteFolderTree } from '../../../notes_svc/note_folder_tree.js';

const zNoteSource = z.nativeEnum(NoteSource);

const zNoteLocator: z.ZodType<NoteLocator> = z.union([
  z.object({ id: z.string().min(1) }).strict(),
  z.object({ source: zNoteSource, external_id: z.string().min(1) }).strict()
]);

const MAX_TAG_FILTER_COUNT = 10;

/** Sentinel for `folder_id` that selects notes not filed in any folder. */
export const UNFILED_FOLDER_ID = 'none';

const zArchived = z.enum(['exclude', 'only', 'include']);

export const zListInput = z.object({
  query: z.string().optional(),
  tags: z.array(z.string().min(1)).max(MAX_TAG_FILTER_COUNT).optional(),
  folder_id: z.string().min(1).optional()
    .describe(`Folder id from notes_folders, or "${UNFILED_FOLDER_ID}" for notes not in any folder.`),
  include_subfolders: z.boolean().optional().describe('With folder_id, also include notes in nested subfolders.'),
  archived: zArchived.optional().describe('Archived notes are excluded by default.'),
  pinned: z.boolean().optional(),
  sort: z.enum(NoteListSort.FIELDS).optional(),
  order: z.enum(NoteListSort.ORDERS).optional(),
  limit: z.number().int().min(0).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0)
});

export const zTagsInput = z.object({
  limit: z.number().int().positive().max(200).optional().default(200)
});

export const zSearchInput = z.object({
  query: z.string().min(1),
  archived: zArchived.optional().describe('Archived notes are excluded by default.'),
  limit: z.number().int().min(0).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0)
});

export const zSearchSemanticInput = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().max(20).optional().default(8),
  source_filter: z.array(zNoteSource).optional(),
  include_archived: z.boolean().optional().default(false)
});

// Only what a person would set by hand. Provider keys, sync state and vectorization are
// written by Cortex itself; letting a model set them could corrupt indexing or collide
// with a OneNote sync, and external assistants reach these schemas too.
export const zCreateInput = z.object({
  title: z.string().min(1),
  body: z.string().default(''),
  body_raw: z.string().optional()
    .describe('The original artifact the body was cleaned from, such as a verbatim transcript. Optional.'),
  tags: z.array(z.string()).optional(),
  folder_id: z.string().min(1).optional().describe('Folder id from notes_folders.'),
  is_archived: z.boolean().optional(),
  is_pinned: z.boolean().optional()
});

const zPatch = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  body_raw: z.string().optional(),
  tags: z.array(z.string()).optional(),
  folder_id: z.string().min(1).nullable().optional().describe('Folder id from notes_folders; null removes the note from its folder.'),
  is_archived: z.boolean().optional(),
  is_pinned: z.boolean().optional()
}).strict();

export const zUpdateInput = z.object({
  locator: zNoteLocator,
  patch: zPatch
});

export const zDeleteInput = z.object({
  locator: zNoteLocator
});

export const zGetInput = z.object({
  locator: zNoteLocator
});

export const zFoldersInput = z.object({});

export const zNoteListOutput = z.object({ total: z.number(), items: z.array(z.any()) });
export const zNoteLookupOutput = z.object({ found: z.boolean(), note: z.any().nullable() });

export const zFolderCreateInput = z.object({
  path: z.string().min(1).describe(
    `Slash-separated folder path such as "Work/Clients", at most ${NoteFolderTree.MAX_DEPTH} levels. ` +
    'Missing folders along the path are created; existing ones are reused.'
  )
});

const zBulkIds = z.array(z.string().min(1)).min(1).max(NoteBulkActionMapper.MAX_IDS);
const zBulkTags = z.array(z.string().min(1)).min(1).max(MAX_TAG_FILTER_COUNT);

// Flat rather than a discriminated union: MCP input schemas are a single object shape.
// Delete is deliberately absent; notes_delete stays the only destructive notes tool.
export const zBulkUpdateInput = z.object({
  ids: zBulkIds,
  action: z.enum(['move', 'archive', 'unarchive', 'pin', 'unpin', 'add_tags', 'remove_tags']),
  folder_id: z.string().min(1).nullable().optional()
    .describe('Required for move: target folder id from notes_folders, or null to take notes out of folders.'),
  tags: zBulkTags.optional().describe('Required for add_tags and remove_tags.')
});

export const zSearchSemanticOutput = z.object({ chunks: z.array(z.any()) });
export const zTagsOutput = z.object({ tags: z.array(z.object({ tag: z.string(), count: z.number() })) });
export const zCreateOutput = z.object({ note: z.any() });
export const zDeleteOutput = z.object({ success: z.boolean() });
export const zFoldersOutput = z.object({ folders: z.array(z.object({ id: z.string(), path: z.string(), note_count: z.number() })) });
export const zFolderCreateOutput = z.object({ folder: z.object({ id: z.string(), path: z.string() }), created_count: z.number() });
export const zBulkUpdateOutput = z.object({ action: z.string(), matched: z.number(), modified: z.number() });
