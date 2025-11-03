import { v4 as uuidv4 } from 'uuid';
import type { AgentSession, SessionLiveMode } from './types/session.types.js';
import type { SessionMessage } from './types/session_message.types.js';
import type { SessionRepository } from './repositories/session_repository_interface.js';
import { createSessionRepository } from './repositories/mongoose_session_repository.js';
import type { SessionMessageRepository } from './repositories/session_message_repository_interface.js';
import { createSessionMessageRepository } from './repositories/mongoose_session_message_repository.js';

/**
 * Simple per-session manager with in-memory session header snapshot.
 * - Construct via createNew() to create a session and get a bound manager
 * - Or via forExisting() to operate on an existing session
 * - Uses env vars for Mongo host/port and a fixed db name 'agent_db'
 *
 *   MONGO_HOST (default: '127.0.0.1')
 *   MONGO_PORT (default: 27017)
 */
export class SessionManager {
  private session!: AgentSession; // in-memory header snapshot

  private constructor(
    private readonly session_repo: SessionRepository,
    private readonly messages_repo: SessionMessageRepository,
    private readonly user_id: string,
    private readonly session_id: string
  ) {}

  static async createNew(params: {
    user_id: string;
    session_name?: string;
    live_mode?: SessionLiveMode;
  }): Promise<{ session: AgentSession; manager: SessionManager }> {
    const { session_repo, messages_repo } = await bootstrapRepos();
    const session_id = uuidv4();
    const final_name = normalizeNonEmptyName(params.session_name) ?? defaultSessionName();
    const live_mode = params.live_mode ?? 'live';

    const session = await session_repo.createSession({
      user_id: params.user_id,
      session_id,
      session_name: final_name,
      live_mode,
      is_archived: false,
      metadata: { message_count: 0 }
    });

    const manager = new SessionManager(session_repo, messages_repo, params.user_id, session_id);
    manager.setSession(session);
    return { session, manager };
  }

  static async forExisting(params: { user_id: string; session_id: string }): Promise<SessionManager> {
    const { session_repo, messages_repo } = await bootstrapRepos();
    const manager = new SessionManager(session_repo, messages_repo, params.user_id, params.session_id);
    const header = await session_repo.getByKey({ user_id: params.user_id, session_id: params.session_id });
    if (!header) {
      throw new Error('Session not found');
    }
    manager.setSession(header);
    return manager;
  }

  private setSession(s: AgentSession) {
    this.session = s;
  }

  async appendUserMessage(user_text: string): Promise<number> {
    const ts = new Date();
    const msgs: Array<SessionMessage> = [
      {
        sender: { name: 'user', role: 'user' },
        model_response_type: 'output',
        content: { data_type: 'string', data: user_text },
        timestamp: ts
      } as SessionMessage
    ];

    const appended = await this.messages_repo.appendMessages({
      user_id: this.user_id,
      session_id: this.session_id,
      messages: msgs
    });

    // write-through header update
    if (!this.session.metadata) this.session.metadata = { message_count: 0 };
    this.session.metadata.message_count = (this.session.metadata.message_count ?? 0) + appended;
    this.session.metadata.last_message_at = ts;
    this.session.updated_at = new Date();

    return appended;
  }

  async appendMessages(messages: SessionMessage[]): Promise<number> {
    const now = new Date();
    // ensure timestamp exists on each message for accurate last_message_at
    const prepared = messages.map((m) => ({
      ...m,
      timestamp: m.timestamp ?? now
    }));

    const appended = await this.messages_repo.appendMessages({
      user_id: this.user_id,
      session_id: this.session_id,
      messages: prepared
    });

    // write-through header update
    const last_ts = prepared.reduce<Date>((acc, cur) => (!acc || cur.timestamp > acc ? cur.timestamp : acc), prepared[0]?.timestamp ?? now);
    if (!this.session.metadata) this.session.metadata = { message_count: 0 };
    this.session.metadata.message_count = (this.session.metadata.message_count ?? 0) + appended;
    this.session.metadata.last_message_at = last_ts;
    this.session.updated_at = new Date();

    return appended;
  }

  getSession(): AgentSession | null {
    return this.session ?? null;
  }

  get ids() {
    return { user_id: this.user_id, session_id: this.session_id };
  }
}

// Internal bootstrap using env for host/port and fixed db 'agent_db'
async function bootstrapRepos(): Promise<{
  session_repo: SessionRepository;
  messages_repo: SessionMessageRepository;
}> {
  const host = process.env.MONGO_HOST ?? '127.0.0.1';
  const port = Number(process.env.MONGO_PORT ?? 27017);
  const db = 'agent_db';

  const session_repo = await createSessionRepository({ db, host, port });
  const messages_repo = await createSessionMessageRepository({ db, host, port });
  return { session_repo, messages_repo };
}

// Helpers

function defaultSessionName(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function normalizeNonEmptyName(name?: string): string | undefined {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
