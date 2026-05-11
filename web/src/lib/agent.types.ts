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
