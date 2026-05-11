export const NOTES_RECALL_AGENT_ID = 'notes-recall';

export type AgentRunRequest = {
  agent_id: string;
  input: string;
  conversation_id?: string;
};

export type AgentStopReason = 'final' | 'max_turns' | 'error';

export type AgentRunResponse = {
  final_output_text?: string;
  conversation_id?: string;
  stop_reason: AgentStopReason;
};

export type Conversation = {
  conversation_id: string;
  agent_id: string;
  title?: string;
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
};

export type ConversationWithMessages = {
  conversation: Conversation;
  messages: ConversationMessage[];
};
