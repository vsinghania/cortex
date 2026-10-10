import type { NoteTagListResponse } from './note.types';

type TagResponse = NoteTagListResponse;
type TagLoader = () => Promise<TagResponse>;

export class NoteTagCache {
  static readonly TTL_MS = 60_000;
  static readonly instance = new NoteTagCache();

  private user_id: string | null = null;
  private cached: TagResponse | null = null;
  private expires_at_ms = 0;
  private pending: Promise<TagResponse> | null = null;
  private generation = 0;

  invalidate(): void {
    this.cached = null;
    this.pending = null;
    this.generation += 1;
  }

  async listTags(user_id: string | null, loader: TagLoader, revalidate = false): Promise<TagResponse> {
    if (revalidate || user_id !== this.user_id) this.invalidate();
    this.user_id = user_id;
    if (!user_id) return loader();
    if (this.cached && Date.now() < this.expires_at_ms) return this.cached;
    if (!this.pending) this.pending = this.loadTags(loader, this.generation);
    return this.pending;
  }

  private async loadTags(loader: TagLoader, generation: number): Promise<TagResponse> {
    try {
      const response = await loader();
      // A refresh, mutation or account change can invalidate a request still in flight.
      if (generation === this.generation) {
        this.cached = response;
        this.expires_at_ms = Date.now() + NoteTagCache.TTL_MS;
      }
      return response;
    } finally {
      if (generation === this.generation) this.pending = null;
    }
  }
}
