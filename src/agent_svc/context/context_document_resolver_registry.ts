import type { ContextDocumentResolverInterface } from './context_document_resolver_interface.js';
import type { ContextDocument } from '../types/context_document.types.js';
import type { ContextRef } from '../types/conversation.types.js';
import { BadRequestError } from '../../common/errors.js';

export class ContextDocumentResolverRegistry {
  private static instance: ContextDocumentResolverRegistry | null = null;

  private resolvers = new Map<string, ContextDocumentResolverInterface>();

  private constructor() {}

  static getInstance(): ContextDocumentResolverRegistry {
    if (ContextDocumentResolverRegistry.instance) return ContextDocumentResolverRegistry.instance;
    ContextDocumentResolverRegistry.instance = new ContextDocumentResolverRegistry();
    return ContextDocumentResolverRegistry.instance;
  }

  registerDocumentResolver(resolver: ContextDocumentResolverInterface): void {
    if (this.resolvers.has(resolver.corpus)) {
      throw new Error(`Context document resolver already registered: ${resolver.corpus}`);
    }
    this.resolvers.set(resolver.corpus, resolver);
  }

  registeredCorpora(): string[] {
    return Array.from(this.resolvers.keys());
  }

  async resolveContextDocument(params: { user_id: string; ref: ContextRef }): Promise<ContextDocument | null> {
    const resolver = this.resolvers.get(params.ref.corpus);
    if (!resolver) {
      throw new BadRequestError(`Unsupported context corpus: ${params.ref.corpus}`);
    }
    return resolver.resolveContextDocument({ user_id: params.user_id, document_id: params.ref.document_id });
  }
}
