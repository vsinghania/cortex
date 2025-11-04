import { v4 as uuidv4 } from 'uuid';
import type { AgentSvcInterface } from './agent_svc_interface.js';
import type { AgentSession } from './types/session.types.js';
import type { SessionMessage } from './types/session_message.types.js';
import { SessionManager } from './session_manager.js';
import { ORCHESTRATOR_AGENT_NAME, Orchestrator } from './orchestrator_stub.js';
import type { Cache } from '../lib/cache/cache.types.js';
import { LruCache } from '../lib/cache/lru_cache.js';
import { logger } from '../common/logger.js';

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TAIL = 50;

type CacheEntry = {
  manager: SessionManager;
  tail: SessionMessage[];
};

export class AgentSvc implements AgentSvcInterface {
  private managers: Cache<string, CacheEntry> = new LruCache<string, CacheEntry>({
    max: 1000,
    default_ttl_ms: TTL_MS,
    update_age_on_get: true,
    on_evict: (key) => {
      try {
        logger.info({ key }, 'session cache evicted');
      } catch {}
    }
  });

  private static appendToTail(entry: CacheEntry, msgs: SessionMessage[]) {
    if (!msgs || msgs.length === 0) return;
    entry.tail.push(...msgs);
    if (entry.tail.length > MAX_TAIL) {
      entry.tail.splice(0, entry.tail.length - MAX_TAIL);
    }
  }

  private static keyFor(user_id: string, session_id: string) {
    return `${user_id}:${session_id}`;
  }

  // Core entrypoint per requirements
  async handleUserPrompt(params: {
    user_id: string;
    prompt: string;
    session_id?: string;
    session_name?: string;
    live_mode?: 'live' | 'background';
  }): Promise<{
    session: AgentSession;
    session_id: string;
    created_new: boolean;
    user_appended_count: number;
    orchestrator_appended_count: number;
    tail_messages?: SessionMessage[];
  }> {
    const { user_id, prompt, session_id, session_name, live_mode } = params;

    const { entry, session, session_id: effective_session_id, created_new } =
      await this.getOrCreateEntry({ user_id, session_id, session_name, live_mode });

    // Build user message with deterministic id/timestamp for cache coherence
    const user_ts = new Date();
    const userMsg: SessionMessage = {
      message_id: uuidv4(),
      sender: { name: 'user', role: 'user' },
      model_response_type: 'output',
      content: { data_type: 'string', data: prompt },
      timestamp: user_ts
    };

    const user_appended_count = await entry.manager.appendMessages([userMsg]);
    AgentSvc.appendToTail(entry, [userMsg]);

    // Orchestrator phase (static name for now)
    const orchestratorRaw = await Orchestrator.runOrchestratorStep({
      user_id,
      session_id: effective_session_id,
      agent_name: ORCHESTRATOR_AGENT_NAME
    });

    const now = new Date();
    const orchestratorMessages: SessionMessage[] = (orchestratorRaw ?? []).map((m) => ({
      // preserve agent-provided fields; add id/ts if missing
      ...m,
      message_id: (m as any)?.message_id ?? uuidv4(),
      timestamp: (m as any)?.timestamp ?? now
    }));

    const orchestrator_appended_count =
      orchestratorMessages.length > 0
        ? await entry.manager.appendMessages(orchestratorMessages)
        : 0;

    AgentSvc.appendToTail(entry, orchestratorMessages);
    this.managers.set(AgentSvc.keyFor(user_id, effective_session_id), entry);

    const header = entry.manager.getSession()!;

    return {
      session: header,
      session_id: effective_session_id,
      created_new,
      user_appended_count,
      orchestrator_appended_count,
      tail_messages: entry.tail.slice() // shallow copy
    };
  }

  // Append agent responses to an existing session (kept for compatibility)
  async appendAgentResponses(params: {
    user_id: string;
    session_id: string;
    agent_messages: SessionMessage[];
  }): Promise<{ appended_count: number }> {
    const { user_id, session_id, agent_messages } = params;
    const { entry } = await this.getOrCreateEntry({ user_id, session_id });

    const now = new Date();
    const prepared: SessionMessage[] = (agent_messages ?? []).map((m) => ({
      ...m,
      message_id: (m as any)?.message_id ?? uuidv4(),
      timestamp: (m as any)?.timestamp ?? now
    }));

    const appended_count =
      prepared.length > 0 ? await entry.manager.appendMessages(prepared) : 0;

    AgentSvc.appendToTail(entry, prepared);
    this.managers.set(AgentSvc.keyFor(user_id, session_id), entry);

    return { appended_count };
  }

  async getSession(params: {
    user_id: string;
    session_id: string;
  }): Promise<AgentSession | null> {
    const { user_id, session_id } = params;
    const k = AgentSvc.keyFor(user_id, session_id);
    const cached = this.managers.get(k);
    if (cached) {
      return cached.manager.getSession();
    }
    // Refresh/initialize from DB
    try {
      const manager = await SessionManager.forExisting({ user_id, session_id });
      const entry: CacheEntry = { manager, tail: [] };
      this.managers.set(k, entry);
      return entry.manager.getSession();
    } catch {
      // Not found
      return null;
    }
  }

  // get or create cached manager (and session if needed)
  private async getOrCreateEntry(params: {
    user_id: string;
    session_id?: string;
    session_name?: string;
    live_mode?: 'live' | 'background';
  }): Promise<{
    entry: CacheEntry;
    session: AgentSession;
    session_id: string;
    created_new: boolean;
  }> {
    const { user_id } = params;

    if (!params.session_id) {
      // Create new
      const { session, manager } = await SessionManager.createNew({
        user_id,
        session_name: params.session_name,
        live_mode: params.live_mode
      });
      const sid = manager.ids.session_id;
      const entry: CacheEntry = { manager, tail: [] };
      this.managers.set(AgentSvc.keyFor(user_id, sid), entry);
      return { entry, session, session_id: sid, created_new: true };
    }

    // Use existing
    const k = AgentSvc.keyFor(user_id, params.session_id);
    const cached = this.managers.get(k);
    if (cached) {
      const header = cached.manager.getSession()!;
      return { entry: cached, session: header, session_id: params.session_id, created_new: false };
    }

    // Rebuild from DB
    const manager = await SessionManager.forExisting({
      user_id,
      session_id: params.session_id
    });
    const header = manager.getSession()!;
    const rebuilt: CacheEntry = { manager, tail: [] };
    this.managers.set(k, rebuilt);
    return { entry: rebuilt, session: header, session_id: params.session_id, created_new: false };
  }
}
