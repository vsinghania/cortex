import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NotesSvc, type NoteUpsertInput, type NotePatch } from '../../../notes_svc/notes_svc.js';
import { NoteSource, Visibility, type NoteContainer, type NoteMetadata, type NoteVectorization } from '../../../notes_svc/types/note.types.js';

// Zod schemas at the untrusted boundary (MCP)
const zUserId = z.string().min(1, 'user_id is required');

const zNoteSource = z.nativeEnum(NoteSource);
const zVisibility = z.nativeEnum(Visibility);

const zContainerType = z.enum(['notebook', 'database', 'folder', 'page', 'section', 'collection', 'other']);
const zNoteContainer: z.ZodType<NoteContainer> = z.object({
  container_type: zContainerType,
  container_id: z.string().min(1),
  container_name: z.string().min(1).optional()
});

const zNoteMetadata = z.object({
  provider_url: z.string().url().optional(),
  provider_etag: z.string().optional(),
  provider_last_modified: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  extra: z.record(z.any()).optional()
});

const zVectorizationStatus = z.enum(['none', 'pending', 'embedded', 'error']);
const zNoteVectorization = z.object({
  status: zVectorizationStatus,
  last_embedded_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  embedding_model: z.string().optional(),
  chunk_count: z.number().int().positive().optional()
});

const zNoteKey = z.object({
  user_id: zUserId,
  source: zNoteSource,
  external_id: z.string().min(1)
});

const zListInput = z.object({
  user_id: zUserId,
  query: z.string().optional(),
  limit: z.number().int().positive().max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0)
});

const zUpsertInput = z.object({
  user_id: zUserId,
  source: zNoteSource,
  external_id: z.string().min(1),

  title: z.string().min(1),
  body_plain: z.string().default(''),
  body_markdown: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: zNoteContainer.optional(),

  created_at_provider: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  updated_at_provider: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),

  visibility: zVisibility.optional(),
  is_archived: z.boolean().optional(),
  is_deleted: z.boolean().optional(),

  metadata: zNoteMetadata.optional(),
  vectorization: zNoteVectorization.optional()
});

const zPatch = z.object({
  title: z.string().optional(),
  body_plain: z.string().optional(),
  body_markdown: z.string().optional(),
  tags: z.array(z.string()).optional(),
  container: zNoteContainer.optional(),

  created_at_provider: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  updated_at_provider: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),
  last_synced_at: z.union([z.coerce.date(), z.string().datetime()]).optional().transform((v) => (v ? new Date(v as any) : undefined)),

  visibility: zVisibility.optional(),
  is_archived: z.boolean().optional(),
  is_deleted: z.boolean().optional(),

  metadata: zNoteMetadata.optional(),
  vectorization: zNoteVectorization.optional()
}).strict();

/**
 * Register MCP tools for notes domain.
 * Tools:
 *  - notes.list       { user_id, query?, limit?, offset? }
 *  - notes.get        { user_id, source, external_id }
 *  - notes.upsert     NoteUpsertInput
 *  - notes.update     { user_id, source, external_id, patch }
 *  - notes.delete     { user_id, source, external_id }
 *  - notes.search     { user_id, query, limit?, offset? }
 */
export function setupNotesTools(server: McpServer, svc: NotesSvc) {
  // notes.list
  server.registerTool(
    'notes.list',
    {
      title: 'List Notes',
      description: 'List notes for a user with optional text query, pagination.',
      inputSchema: zListInput.shape,
      outputSchema: {
        total: z.number(),
        items: z.array(z.any())
      }
    },
    async (raw: unknown) => {
      const args = zListInput.parse(raw ?? {});
      const result = await svc.listNotes(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // notes.get
  server.registerTool(
    'notes.get',
    {
      title: 'Get Note by Key',
      description: 'Get a note by composite key (user_id, source, external_id).',
      inputSchema: zNoteKey.shape,
      outputSchema: {
        found: z.boolean(),
        note: z.any().nullable()
      }
    },
    async (raw: unknown) => {
      const key = zNoteKey.parse(raw ?? {});
      const note = await svc.getNoteByKey(key);
      const out = { found: !!note, note: note ?? null };
      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        structuredContent: out
      };
    }
  );

  // notes.upsert
  server.registerTool(
    'notes.upsert',
    {
      title: 'Upsert Note',
      description: 'Create or update a note by composite key.',
      inputSchema: zUpsertInput.shape,
      outputSchema: { note: z.any() }
    },
    async (raw: unknown) => {
      const input = zUpsertInput.parse(raw ?? {});
      const note = await svc.upsertNote(input);
      const out = { note };
      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        structuredContent: out
      };
    }
  );

  // notes.update
  server.registerTool(
    'notes.update',
    {
      title: 'Update Note (partial)',
      description: 'Update a note by composite key (partial patch).',
      inputSchema: {
        ...zNoteKey.shape,
        patch: zPatch
      },
      outputSchema: {
        found: z.boolean(),
        note: z.any().nullable()
      }
    },
    async (raw: unknown) => {
      const key = zNoteKey.parse(raw ?? {});
      const patch = zPatch.parse((raw as any)?.patch ?? {});
      const updated = await svc.updateNoteByKey({ ...key, patch });
      const out = { found: !!updated, note: updated ?? null };
      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        structuredContent: out
      };
    }
  );

  // notes.delete
  server.registerTool(
    'notes.delete',
    {
      title: 'Delete Note',
      description: 'Delete a note by composite key.',
      inputSchema: zNoteKey.shape,
      outputSchema: { success: z.boolean() }
    },
    async (raw: unknown) => {
      const key = zNoteKey.parse(raw ?? {});
      const ok = await svc.deleteNoteByKey(key);
      const out = { success: ok };
      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        structuredContent: out
      };
    }
  );

  // notes.search
  server.registerTool(
    'notes.search',
    {
      title: 'Search Notes',
      description: 'Full-text search across title/body/tags for a user.',
      inputSchema: {
        user_id: zUserId,
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional().default(20),
        offset: z.number().int().min(0).optional().default(0)
      },
      outputSchema: {
        total: z.number(),
        items: z.array(z.any())
      }
    },
    async (raw: unknown) => {
      const args = z
        .object({
          user_id: zUserId,
          query: z.string().min(1),
          limit: z.number().int().positive().max(100).optional().default(20),
          offset: z.number().int().min(0).optional().default(0)
        })
        .parse(raw ?? {});
      const result = await svc.searchNotes(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );
}
