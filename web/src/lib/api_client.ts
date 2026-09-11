import { AuthStore } from './auth_store';
import type { AuthResponse, RefreshResponse, User } from './auth.types';
import type {
  Note,
  NoteChunkRef,
  NoteCreateBody,
  NoteListResponse,
  NotePatchBody,
  NoteTagCount,
} from './note.types';
import type { AgentRunRequest, AgentRunResponse, Conversation, ConversationWithMessages } from './agent.types';
import type { MintTokenResponse } from './voice.types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) ?? 'http://localhost:3000/api/v1';

type Envelope<T> = { response: T };

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class ApiClient {
  private static refresh_promise: Promise<void> | null = null;

  // Calls that work without a session, where a 401 is an answer rather than an
  // expired access token worth refreshing.
  private static readonly NO_REFRESH_PATHS = new Set([
    '/auth/refresh',
    '/auth/login',
    '/auth/register',
    '/auth/password/forgot',
    '/auth/password/reset',
  ]);

  private static async request<T>(
    path: string,
    init: RequestInit = {},
    retried = false,
  ): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    const token = AuthStore.instance().getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });

    if (res.status === 401 && !retried && !ApiClient.NO_REFRESH_PATHS.has(path)) {
      try {
        await ApiClient.runSilentRefresh();
      } catch (err) {
        AuthStore.instance().clear();
        throw err;
      }
      return ApiClient.request<T>(path, init, true);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    const parsed = text ? ApiClient.safeParseJson(text) : undefined;

    if (!res.ok) {
      const message = ApiClient.extractErrorMessage(parsed) ?? `HTTP ${res.status}`;
      throw new ApiError(res.status, message, parsed);
    }

    if (parsed && typeof parsed === 'object' && 'response' in (parsed as Record<string, unknown>)) {
      return (parsed as Envelope<T>).response;
    }
    return parsed as T;
  }

  private static safeParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private static extractErrorMessage(parsed: unknown): string | null {
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      // API errors are RFC 7807 problem details; the rate limiter sends { error }.
      if (typeof obj.detail === 'string') return obj.detail;
      if (typeof obj.error === 'string') return obj.error;
      if (typeof obj.message === 'string') return obj.message;
      if (obj.error && typeof obj.error === 'object') {
        const err = obj.error as Record<string, unknown>;
        if (typeof err.message === 'string') return err.message;
      }
    }
    return null;
  }

  private static runSilentRefresh(): Promise<void> {
    if (!ApiClient.refresh_promise) {
      ApiClient.refresh_promise = ApiClient.doRefresh().finally(() => {
        ApiClient.refresh_promise = null;
      });
    }
    return ApiClient.refresh_promise;
  }

  private static async doRefresh(): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      throw new ApiError(res.status, 'Refresh failed', null);
    }
    const json = (await res.json()) as Envelope<RefreshResponse>;
    AuthStore.instance().setToken(json.response.access_token);
  }

  static async bootstrapSession(): Promise<boolean> {
    try {
      await ApiClient.doRefresh();
      const user = await ApiClient.me();
      AuthStore.instance().setUser(user);
      return true;
    } catch {
      AuthStore.instance().clear();
      return false;
    }
  }

  static async login(email: string, password: string): Promise<AuthResponse> {
    const result = await ApiClient.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    AuthStore.instance().setSession(result.access_token, result.user);
    return result;
  }

  static async register(email: string, name: string, password: string): Promise<AuthResponse> {
    const result = await ApiClient.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name, password }),
    });
    AuthStore.instance().setSession(result.access_token, result.user);
    return result;
  }

  static async logout(): Promise<void> {
    try {
      await ApiClient.request<{ success: true }>('/auth/logout', { method: 'POST' });
    } finally {
      AuthStore.instance().clear();
    }
  }

  static async me(): Promise<User> {
    return ApiClient.request<User>('/auth/me');
  }

  static async forgotPassword(email: string): Promise<void> {
    await ApiClient.request<{ accepted: true }>('/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  static async resetPassword(token: string, password: string): Promise<void> {
    await ApiClient.request<{ success: true }>('/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  static async listNotes(
    params: { limit?: number; offset?: number; tags?: string[] } = {},
  ): Promise<NoteListResponse> {
    const query = new URLSearchParams();
    if (params.limit != null) query.set('limit', String(params.limit));
    if (params.offset != null) query.set('offset', String(params.offset));
    // append, not set - the server reads tags as a repeated query param.
    params.tags?.forEach((tag) => query.append('tags', tag));
    const qs = query.toString();
    return ApiClient.request<NoteListResponse>(`/notes${qs ? `?${qs}` : ''}`);
  }

  static async listNoteTags(): Promise<{ tags: NoteTagCount[] }> {
    return ApiClient.request<{ tags: NoteTagCount[] }>('/notes/tags');
  }

  static async getNote(id: string): Promise<{ note: Note }> {
    return ApiClient.request<{ note: Note }>(`/notes/${encodeURIComponent(id)}`);
  }

  static async getNoteChunk(note_id: string, chunk_id: string): Promise<{ chunk: NoteChunkRef }> {
    return ApiClient.request<{ chunk: NoteChunkRef }>(
      `/notes/${encodeURIComponent(note_id)}/chunks/${encodeURIComponent(chunk_id)}`,
    );
  }

  static async createNote(body: NoteCreateBody): Promise<{ note: Note }> {
    return ApiClient.request<{ note: Note }>('/notes', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static async updateNote(id: string, body: NotePatchBody): Promise<{ note: Note }> {
    return ApiClient.request<{ note: Note }>(`/notes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  static async deleteNote(id: string): Promise<void> {
    await ApiClient.request<void>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  static async runAgent(req: AgentRunRequest): Promise<AgentRunResponse> {
    return ApiClient.request<AgentRunResponse>('/agent/run', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  static async listConversations(params: { limit?: number; before_updated_at?: string } = {}): Promise<Conversation[]> {
    const query = new URLSearchParams();
    if (params.limit != null) query.set('limit', String(params.limit));
    if (params.before_updated_at) query.set('before_updated_at', params.before_updated_at);
    const qs = query.toString();
    return ApiClient.request<Conversation[]>(`/agent/conversations${qs ? `?${qs}` : ''}`);
  }

  static async getConversation(conversation_id: string): Promise<ConversationWithMessages> {
    return ApiClient.request<ConversationWithMessages>(`/agent/conversations/${encodeURIComponent(conversation_id)}`);
  }

  static async mintVoiceToken(): Promise<MintTokenResponse> {
    return ApiClient.request<MintTokenResponse>('/voice/session', { method: 'POST' });
  }
}
