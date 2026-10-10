import { AuthStore } from './auth_store';
import { NoteTagCache } from './note_tag_cache';
import type { AuthResponse, RefreshResponse, RegisterResponse, User } from './auth.types';
import type {
  Note,
  NoteBulkAction,
  NoteBulkResult,
  NoteChunkRef,
  NoteCreateBody,
  NoteFilingSuggestion,
  NoteFilingSuggestionBody,
  NoteListQuery,
  NoteListResponse,
  NotePatchBody,
  NoteTagListResponse,
} from './note.types';
import type {
  NoteFolderCreateBody,
  NoteFolderDeleteResult,
  NoteFolderNode,
  NoteFolderPatchBody,
} from './note_folder.types';
import type { AgentRunRequest, AgentRunResponse, ContextRef, Conversation, ConversationPatch, ConversationWithMessages } from './agent.types';
import type { MintTokenResponse } from './voice.types';
import type {
  OneNoteConnection,
  OneNoteNotebook,
  OneNoteStatus,
  OneNoteSyncJob,
  OneNoteSyncStart,
} from './onenote.types';
import type { AdminUserPage } from './admin.types';
import type { ConnectedAppsStatus, McpAccess, OAuthConsentRequest } from './connected_apps.types';

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

  /** The problem document's `type`, which names the error more precisely than the status. */
  hasType(type: string): boolean {
    return !!this.body && typeof this.body === 'object' && (this.body as Record<string, unknown>).type === type;
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
    '/auth/email/verify',
    '/auth/email/verify/request',
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
      // Shared with any concurrent refresh: refresh tokens rotate, so a second call racing
      // on the same cookie fails and would sign the user out (StrictMode runs boot twice).
      await ApiClient.runSilentRefresh();
      await ApiClient.refreshUser();
      return true;
    } catch {
      AuthStore.instance().clear();
      return false;
    }
  }

  /** Re-reads the user into the store, for fields the server changed behind our back. */
  static async refreshUser(): Promise<User> {
    const user = await ApiClient.me();
    AuthStore.instance().setUser(user);
    return user;
  }

  static async getOneNoteStatus(): Promise<OneNoteStatus> {
    return ApiClient.request<OneNoteStatus>('/integrations/onenote/status');
  }

  /**
   * Answers with the URL instead of redirecting, so this call can carry the bearer
   * token; the caller then navigates, which is what the OAuth flow needs.
   */
  static async startOneNoteConnect(): Promise<{ url: string }> {
    return ApiClient.request<{ url: string }>('/integrations/onenote/start', { method: 'POST' });
  }

  static async disconnectOneNote(): Promise<{ disconnected: boolean }> {
    return ApiClient.request<{ disconnected: boolean }>('/integrations/onenote', { method: 'DELETE' });
  }

  /** Served from the server's cache unless `refresh` asks it to call Microsoft again. */
  static async getOneNoteNotebooks(refresh = false): Promise<{ notebooks: OneNoteNotebook[] }> {
    return ApiClient.request<{ notebooks: OneNoteNotebook[] }>(
      `/integrations/onenote/notebooks${refresh ? '?refresh=1' : ''}`,
    );
  }

  static async selectOneNoteNotebooks(notebook_ids: string[]): Promise<{ connection: OneNoteConnection }> {
    return ApiClient.request<{ connection: OneNoteConnection }>('/integrations/onenote/notebooks', {
      method: 'PUT',
      body: JSON.stringify({ notebook_ids }),
    });
  }

  static async startOneNoteSync(
    params: { mode?: 'incremental' | 'full'; notebook_ids?: string[] } = {},
  ): Promise<OneNoteSyncStart> {
    return ApiClient.request<OneNoteSyncStart>('/integrations/onenote/sync', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /** Re-reads one page from OneNote now; inline, so it answers with the updated note. */
  static async syncOneNoteNote(note_id: string): Promise<{ note: Note }> {
    return ApiClient.request<{ note: Note }>(
      `/integrations/onenote/notes/${encodeURIComponent(note_id)}/sync`,
      { method: 'POST' },
    );
  }

  static async getOneNoteSyncJob(job_id: string): Promise<{ job: OneNoteSyncJob }> {
    return ApiClient.request<{ job: OneNoteSyncJob }>(`/integrations/onenote/sync/${encodeURIComponent(job_id)}`);
  }

  static async getOAuthRequest(request_id: string): Promise<{ request: OAuthConsentRequest }> {
    return ApiClient.request<{ request: OAuthConsentRequest }>(`/oauth/requests/${encodeURIComponent(request_id)}`);
  }

  /** Answers with where to send the browser: the app's redirect, carrying the code. */
  static async approveOAuthRequest(request_id: string, access: McpAccess): Promise<{ redirect_url: string }> {
    return ApiClient.request<{ redirect_url: string }>(`/oauth/requests/${encodeURIComponent(request_id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ access }),
    });
  }

  static async denyOAuthRequest(request_id: string): Promise<{ redirect_url: string }> {
    return ApiClient.request<{ redirect_url: string }>(`/oauth/requests/${encodeURIComponent(request_id)}/deny`, {
      method: 'POST',
    });
  }

  static async getConnectedApps(): Promise<ConnectedAppsStatus> {
    return ApiClient.request<ConnectedAppsStatus>('/oauth/grants');
  }

  static async disconnectApp(grant_id: string): Promise<void> {
    return ApiClient.request<void>(`/oauth/grants/${encodeURIComponent(grant_id)}`, { method: 'DELETE' });
  }

  static async listAdminUsers(params: { limit: number; offset: number }): Promise<AdminUserPage> {
    const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    return ApiClient.request<AdminUserPage>(`/admin/users?${query.toString()}`);
  }

  static googleSignInUrl(return_to?: string): string {
    const url = new URL(`${API_BASE_URL}/auth/google/start`);
    if (return_to) url.searchParams.set('return_to', return_to);
    return url.toString();
  }

  static async login(email: string, password: string): Promise<AuthResponse> {
    const result = await ApiClient.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    AuthStore.instance().setSession(result.access_token, result.user);
    return result;
  }

  static async register(email: string, name: string, password: string): Promise<RegisterResponse> {
    return ApiClient.request<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name, password }),
    });
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

  static async verifyEmail(token: string): Promise<void> {
    await ApiClient.request<{ success: true }>('/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  /** For a signed-out caller, such as a new account that cannot sign in until confirmed. */
  static async requestVerification(email: string): Promise<void> {
    await ApiClient.request<{ accepted: true }>('/auth/email/verify/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  static async resendVerification(): Promise<void> {
    await ApiClient.request<{ accepted: true }>('/auth/email/verify/resend', { method: 'POST' });
  }

  static async listNotes(params: NoteListQuery = {}, revalidate = false): Promise<NoteListResponse> {
    const query = new URLSearchParams();
    if (params.limit != null) query.set('limit', String(params.limit));
    if (params.offset != null) query.set('offset', String(params.offset));
    // append, not set - the server reads tags as a repeated query param.
    params.tags?.forEach((tag) => query.append('tags', tag));
    if (params.q) query.set('q', params.q);
    if (params.folder_id) query.set('folder_id', params.folder_id);
    if (params.include_subfolders != null) query.set('include_subfolders', String(params.include_subfolders));
    if (params.archived) query.set('archived', params.archived);
    if (params.pinned != null) query.set('pinned', String(params.pinned));
    if (params.sort) query.set('sort', params.sort);
    if (params.order) query.set('order', params.order);
    const qs = query.toString();
    return ApiClient.request<NoteListResponse>(`/notes${qs ? `?${qs}` : ''}`, { cache: revalidate ? 'no-cache' : 'default' });
  }

  static async listNoteTags(revalidate = false): Promise<NoteTagListResponse> {
    return NoteTagCache.instance.listTags(
      AuthStore.instance().getUser()?.user_id ?? null,
      () => ApiClient.request<NoteTagListResponse>('/notes/tags?all=true', { cache: 'no-store' }),
      revalidate,
    );
  }

  static async getNote(id: string, revalidate = false): Promise<{ note: Note }> {
    return ApiClient.request<{ note: Note }>(`/notes/${encodeURIComponent(id)}`, { cache: revalidate ? 'no-cache' : 'default' });
  }

  static async getNoteChunk(note_id: string, chunk_id: string): Promise<{ chunk: NoteChunkRef }> {
    return ApiClient.request<{ chunk: NoteChunkRef }>(
      `/notes/${encodeURIComponent(note_id)}/chunks/${encodeURIComponent(chunk_id)}`,
    );
  }

  static async createNote(body: NoteCreateBody): Promise<{ note: Note }> {
    const response = await ApiClient.request<{ note: Note }>('/notes', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (response.note.tags.length > 0) NoteTagCache.instance.invalidate();
    return response;
  }

  static async updateNote(id: string, body: NotePatchBody): Promise<{ note: Note }> {
    try {
      return await ApiClient.request<{ note: Note }>(`/notes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    } finally {
      if (body.tags !== undefined) NoteTagCache.instance.invalidate();
    }
  }

  static async deleteNote(id: string): Promise<void> {
    await ApiClient.request<void>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    NoteTagCache.instance.invalidate();
  }

  /** One request per call; the server caps `ids` at 100, so callers batch larger selections. */
  static async bulkUpdateNotes(ids: string[], action: NoteBulkAction): Promise<NoteBulkResult> {
    try {
      return await ApiClient.request<NoteBulkResult>('/notes/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, ...action }),
      });
    } finally {
      if (action.action === 'add_tags' || action.action === 'remove_tags' || action.action === 'delete') {
        NoteTagCache.instance.invalidate();
      }
    }
  }

  /** Asks the model where content would be filed; nothing is saved. */
  static async suggestNoteFiling(body: NoteFilingSuggestionBody): Promise<{ suggestion: NoteFilingSuggestion }> {
    return ApiClient.request<{ suggestion: NoteFilingSuggestion }>('/notes/filing_suggestion', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static async listFolders(revalidate = false): Promise<{ folders: NoteFolderNode[] }> {
    return ApiClient.request<{ folders: NoteFolderNode[] }>('/notes/folders', { cache: revalidate ? 'no-cache' : 'default' });
  }

  static async createFolder(body: NoteFolderCreateBody): Promise<{ folder: NoteFolderNode }> {
    return ApiClient.request<{ folder: NoteFolderNode }>('/notes/folders', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static async updateFolder(folder_id: string, body: NoteFolderPatchBody): Promise<{ folder: NoteFolderNode }> {
    return ApiClient.request<{ folder: NoteFolderNode }>(`/notes/folders/${encodeURIComponent(folder_id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  static async deleteFolder(folder_id: string): Promise<NoteFolderDeleteResult> {
    const response = await ApiClient.request<NoteFolderDeleteResult>(`/notes/folders/${encodeURIComponent(folder_id)}`, {
      method: 'DELETE',
    });
    NoteTagCache.instance.invalidate();
    return response;
  }

  static async runAgent(req: AgentRunRequest): Promise<AgentRunResponse> {
    return ApiClient.request<AgentRunResponse>('/agent/run', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  static async listConversations(
    params: { limit?: number; before_updated_at?: string; pinned?: boolean; context_ref?: ContextRef } = {},
  ): Promise<Conversation[]> {
    const query = new URLSearchParams();
    if (params.limit != null) query.set('limit', String(params.limit));
    if (params.before_updated_at) query.set('before_updated_at', params.before_updated_at);
    if (params.pinned != null) query.set('pinned', String(params.pinned));
    if (params.context_ref) {
      query.set('context_corpus', params.context_ref.corpus);
      query.set('context_document_id', params.context_ref.document_id);
    }
    const qs = query.toString();
    return ApiClient.request<Conversation[]>(`/agent/conversations${qs ? `?${qs}` : ''}`);
  }

  static async getConversation(conversation_id: string): Promise<ConversationWithMessages> {
    return ApiClient.request<ConversationWithMessages>(`/agent/conversations/${encodeURIComponent(conversation_id)}`);
  }

  static async updateConversation(conversation_id: string, patch: ConversationPatch): Promise<{ conversation: Conversation }> {
    return ApiClient.request<{ conversation: Conversation }>(
      `/agent/conversations/${encodeURIComponent(conversation_id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  }

  static async deleteConversation(conversation_id: string): Promise<void> {
    await ApiClient.request<void>(`/agent/conversations/${encodeURIComponent(conversation_id)}`, {
      method: 'DELETE',
    });
  }

  static async mintVoiceToken(): Promise<MintTokenResponse> {
    return ApiClient.request<MintTokenResponse>('/voice/session', { method: 'POST' });
  }
}
