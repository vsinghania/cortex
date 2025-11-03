import type { AgentSession, CreateSessionInput, UpdateSessionPatch } from '../types/session.types.js';

export type SessionListParams = {
  user_id: string;
  live_mode?: AgentSession['live_mode'];
  is_archived?: boolean;
  limit?: number;   // default 20, clamp [1..100]
  offset?: number;  // default 0
};

export type SessionListResult = {
  items: AgentSession[];
  total: number;
};

export interface SessionRepository {
  createSession(input: CreateSessionInput): Promise<AgentSession>;

  getByKey(params: { user_id: string; session_id: string }): Promise<AgentSession | null>;

  listSessions(params: SessionListParams): Promise<SessionListResult>;

  updateMeta(params: {
    user_id: string;
    session_id: string;
    patch: UpdateSessionPatch;
  }): Promise<AgentSession | null>;

  deleteByKey(params: { user_id: string; session_id: string }): Promise<boolean>;
}
