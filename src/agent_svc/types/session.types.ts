export type SessionLiveMode = 'live' | 'background';

export type SessionSummaryAgent = {
  agent_id?: string;
  agent_name?: string;
  first_used_at: Date;
  last_used_at: Date;
};

export type SessionMetadata = {
  message_count: number;
  last_message_at?: Date;
  agents?: SessionSummaryAgent[];
};

export interface AgentSession {
  user_id: string;      // UUID (domain id)
  session_id: string;   // UUID (domain id)
  session_name: string;
  live_mode: SessionLiveMode;
  is_archived: boolean;
  metadata?: SessionMetadata;

  created_at: Date;
  updated_at: Date;
}

export type CreateSessionInput = Omit<AgentSession, 'created_at' | 'updated_at'>;

export type UpdateSessionPatch = Partial<Pick<AgentSession, 'session_name' | 'live_mode' | 'is_archived'>>;
