import { ContextDocumentResolverRegistry } from '../../agent_svc/context/context_document_resolver_registry.js';
import { NotesContextDocumentResolver } from '../agent/notes_context_document_resolver.js';
import { logger } from '../../common/logger.js';

/**
 * Hands agent_svc the corpora a chat can be anchored to. Lives in the composition root
 * because agent_svc must not import notes_svc (scripts/layering.test.ts).
 */
export class ContextDocumentResolverBootstrap {
  private constructor() {}

  static registerAll(): void {
    const registry = ContextDocumentResolverRegistry.getInstance();
    registry.registerDocumentResolver(new NotesContextDocumentResolver());
    logger.info({ corpora: registry.registeredCorpora() }, 'Context document resolvers registered');
  }
}
