import type { AgentSession, SessionLiveMode } from './types/session.types.js';
import type { SessionMessage } from './types/session_message.types.js';

export interface AgentSvcInterface {
  handleUserPrompt(params: {
    user_id: string;
    prompt: string;
    session_id?: string;
    session_name?: string;
    live_mode?: SessionLiveMode;
  }): Promise<{
    session: AgentSession;
    session_id: string;
    created_new: boolean;
    user_appended_count: number;
    orchestrator_appended_count: number;
    tail_messages?: SessionMessage[];
  }>;

  appendAgentResponses(params: {
    user_id: string;
    session_id: string;
    agent_messages: SessionMessage[];
  }): Promise<{ appended_count: number }>;

  getSession(params: {
    user_id: string;
    session_id: string;
  }): Promise<AgentSession | null>;
}
