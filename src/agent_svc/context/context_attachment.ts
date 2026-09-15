import type { ContextDocument } from '../types/context_document.types.js';
import type { ContextRef, Conversation } from '../types/conversation.types.js';
import type { Message } from '../types/message.types.js';
import { ContextDocumentResolverRegistry } from './context_document_resolver_registry.js';
import { ContextMessageBuilder } from './context_message_builder.js';
import { BadRequestError, NotFoundError } from '../../common/errors.js';
import { logger } from '../../common/logger.js';

export type ResolvedAttachment = {
  context_messages: Message[];
  attached: boolean;
  truncated: boolean;
};

/**
 * Decides which document, if any, a run sees. A conversation's stored context_ref wins over
 * the request's, so a thread continued from anywhere keeps the document it was started on.
 */
export class ContextAttachment {
  private static readonly NONE: ResolvedAttachment = { context_messages: [], attached: false, truncated: false };

  private constructor() {}

  /**
   * Checked before the conversation exists, so a thread is never created anchored to a
   * document the user cannot read.
   */
  static async requireRequested(params: { user_id?: string; ref?: ContextRef }): Promise<ContextDocument | null> {
    if (!params.ref) return null;
    if (!params.user_id) {
      throw new BadRequestError('context_ref requires an authenticated user');
    }
    const doc = await ContextDocumentResolverRegistry.getInstance().resolve({ user_id: params.user_id, ref: params.ref });
    if (!doc) {
      throw new NotFoundError(`Context document not found: ${params.ref.document_id}`);
    }
    return doc;
  }

  static async forConversation(params: {
    user_id?: string;
    conversation: Conversation;
    requested_doc: ContextDocument | null;
  }): Promise<ResolvedAttachment> {
    const ref = params.conversation.context_ref;
    if (!ref || !params.user_id) return ContextAttachment.NONE;

    const doc = ContextAttachment.matchesRef(params.requested_doc, ref)
      ? params.requested_doc
      : await ContextAttachment.tryResolve(params.user_id, params.conversation.conversation_id, ref);
    if (!doc) return ContextAttachment.NONE;

    const { message, truncated } = ContextMessageBuilder.build(doc);
    return { context_messages: [message], attached: true, truncated };
  }

  private static matchesRef(doc: ContextDocument | null, ref: ContextRef): doc is ContextDocument {
    return !!doc && doc.corpus === ref.corpus && doc.document_id === ref.document_id;
  }

  /** A deleted document should not break the thread; the run just proceeds without it. */
  private static async tryResolve(user_id: string, conversation_id: string, ref: ContextRef): Promise<ContextDocument | null> {
    try {
      const doc = await ContextDocumentResolverRegistry.getInstance().resolve({ user_id, ref });
      if (!doc) {
        logger.warn({ conversation_id, corpus: ref.corpus, document_id: ref.document_id }, 'context document unavailable; running without it');
      }
      return doc;
    } catch (err) {
      logger.warn({ err, conversation_id, corpus: ref.corpus }, 'context document resolution failed; running without it');
      return null;
    }
  }
}
