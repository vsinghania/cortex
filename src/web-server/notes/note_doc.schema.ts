import { z } from 'zod';
import type { NoteDocMark, NoteDocNode } from '../../notes_svc/types/note.types.js';

type DocShapeStats = {
  depth: number;
  node_count: number;
};

/**
 * Validates only the generic Tiptap/ProseMirror JSON shape. Which node and mark types
 * are meaningful is the editor's concern: it drops unknown ones when loading a doc, so
 * the server does not need to track the extension list.
 */
export class NoteDocSchema {
  static readonly MAX_DEPTH = 50;
  static readonly MAX_NODES = 50_000;
  static readonly MAX_BYTES = 1_000_000;
  static readonly MAX_VERSION = 1_000;

  private static readonly attrs = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));

  private static readonly mark: z.ZodType<NoteDocMark> = z.object({
    type: z.string().min(1).max(64),
    attrs: NoteDocSchema.attrs.optional()
  }).strict();

  private static readonly node: z.ZodType<NoteDocNode> = z.lazy(() =>
    z.object({
      type: z.string().min(1).max(64),
      attrs: NoteDocSchema.attrs.optional(),
      content: z.array(NoteDocSchema.node).optional(),
      marks: z.array(NoteDocSchema.mark).optional(),
      text: z.string().optional()
    }).strict()
  );

  /**
   * Shape limits run before the recursive parse so a pathologically deep payload is
   * rejected without recursing through it.
   */
  static readonly doc: z.ZodType<NoteDocNode, z.ZodTypeDef, unknown> = z
    .unknown()
    .superRefine((value, ctx) => NoteDocSchema.checkLimits(value, ctx))
    .pipe(NoteDocSchema.node)
    .refine((doc) => doc.type === 'doc', { message: 'Root node must be of type "doc".' });

  static readonly version = z.number().int().positive().max(NoteDocSchema.MAX_VERSION);

  private constructor() {}

  /** The client derives `body` from `body_doc`; accepting one without the other would let them drift. */
  static isSentWithBody(value: { body?: string; body_doc?: unknown; body_doc_version?: number }): boolean {
    return value.body_doc === undefined
      ? value.body_doc_version === undefined
      : value.body !== undefined && value.body_doc_version !== undefined;
  }

  private static checkLimits(value: unknown, ctx: z.RefinementCtx): void {
    const stats = NoteDocSchema.measure(value);
    if (stats.depth > NoteDocSchema.MAX_DEPTH) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Document nesting exceeds ${NoteDocSchema.MAX_DEPTH} levels.` });
      return;
    }
    if (stats.node_count > NoteDocSchema.MAX_NODES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Document exceeds ${NoteDocSchema.MAX_NODES} nodes.` });
      return;
    }
    if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > NoteDocSchema.MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Document exceeds ${NoteDocSchema.MAX_BYTES} bytes.` });
    }
  }

  /** Iterative walk over `content` arrays; stops early once a limit is crossed. */
  private static measure(root: unknown): DocShapeStats {
    const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 1 }];
    const stats: DocShapeStats = { depth: 0, node_count: 0 };

    while (stack.length > 0) {
      const { value, depth } = stack.pop()!;
      stats.node_count++;
      stats.depth = Math.max(stats.depth, depth);
      if (stats.depth > NoteDocSchema.MAX_DEPTH || stats.node_count > NoteDocSchema.MAX_NODES) break;

      const content = value && typeof value === 'object' ? (value as { content?: unknown }).content : undefined;
      if (Array.isArray(content)) {
        for (const child of content) stack.push({ value: child, depth: depth + 1 });
      }
    }

    return stats;
  }
}
