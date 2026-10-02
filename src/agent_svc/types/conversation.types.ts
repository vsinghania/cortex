import type { AgentUsage } from './agent.types.js';
import type { Message } from './message.types.js';
import type { CitationView } from '../../citation_svc/types/citation.types.js';

/**
 * A document a conversation is anchored to, e.g. the note a chat was started from. Corpus and
 * id only: the document itself is resolved fresh on every run, so edits reach the next turn.
 */
export type ContextRef = {
  corpus: string;
  document_id: string;
};

export type Conversation = {
  conversation_id: string;
  user_id?: string;
  agent_id: string;
  context_ref?: ContextRef;
  title?: string;
  is_pinned: boolean;
  last_provider_response_id?: string;
  created_at: Date;
  updated_at: Date;
};

/** The fields a user may change on their own conversation. */
export type ConversationPatch = {
  is_pinned?: boolean;
  title?: string;
};

export type ConversationMessageMeta = {
  conversation_id: string;
  turn: number;
  created_at: Date;
  usage?: AgentUsage;
  model?: string;
};

export type ConversationMessage = Message & ConversationMessageMeta;

/**
 * A message on its way out, with stored citations swapped for resolved ones.
 *
 * Distributes over the message union so each member keeps its own discriminant and fields;
 * a plain Omit would collapse them to their common properties.
 */
type WithCitationView<T> = T extends unknown
  ? 'citations' extends keyof T
    ? Omit<T, 'citations'> & { citations?: CitationView[] }
    : T
  : never;

export type ConversationMessageView = WithCitationView<ConversationMessage>;

export type AppendTurnInput = {
  conversation_id: string;
  user_id?: string;
  agent_id: string;
  messages: Message[];
  usage: AgentUsage;
  model?: string;
};
