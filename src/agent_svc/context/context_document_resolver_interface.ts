import type { ContextDocument } from '../types/context_document.types.js';

/**
 * Loads one corpus's documents for attachment to a run. Implementations live outside
 * agent_svc (it must not import domain modules, see scripts/layering.test.ts) and are
 * registered from the composition root.
 */
export interface ContextDocumentResolverInterface {
  readonly corpus: string;

  /** User-scoped: returns null for a document the user does not own or that no longer exists. */
  resolveContextDocument(params: { user_id: string; document_id: string }): Promise<ContextDocument | null>;
}
