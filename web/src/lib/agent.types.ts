export const NOTES_RECALL_AGENT_ID = 'notes-recall';

export type AgentRunRequest = {
  agent_id: string;
  input: string;
  conversation_id?: string;
};

export type AgentStopReason = 'final' | 'max_turns' | 'error';

/**
 * Mirrors CitationView in src/citation_svc/types/citation.types.ts.
 * document_title and heading_path are joined from live data server-side, not stored.
 */
export type Citation = {
  index: number;
  chunk_id: string;
  document_id: string;
  corpus: string;
  document_title: string;
  heading_path?: string[];
  document_available: boolean;
  chunk_available: boolean;
};

export type AgentRunResponse = {
  final_output_text?: string;
  conversation_id?: string;
  stop_reason: AgentStopReason;
  citations?: Citation[];
};

export type Conversation = {
  conversation_id: string;
  agent_id: string;
  title?: string;
  is_pinned?: boolean;
  created_at: string;
  updated_at: string;
};

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'json'; data: unknown }
  | { type: 'image'; url: string };

export type ConversationMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ContentPart[];
  turn: number;
  created_at: string;
  citations?: Citation[];
};

export type ConversationWithMessages = {
  conversation: Conversation;
  messages: ConversationMessage[];
};
