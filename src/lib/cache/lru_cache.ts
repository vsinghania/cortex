import { LRUCache } from "lru-cache";
import type { Cache, CacheOptions } from "./cache.types.js";

/**
 * LRU-backed cache with TTL and sliding expiration (on get) via wrapper logic.
 * - Uses lru-cache v10 with ttlAutopurge enabled
 * - Supports single-flight getOrCompute
 */
export class LruCache<K extends {}, V extends {}> implements Cache<K, V> {
  private readonly lru: LRUCache<K, V>;
  private readonly default_ttl: number;
  private readonly opts: CacheOptions;
  private readonly pending = new Map<K, Promise<V>>();

  constructor(opts: CacheOptions = {}) {
    this.opts = opts;
    this.default_ttl = opts.default_ttl_ms ?? 0;

    this.lru = new LRUCache<K, V>({
      max: opts.max ?? 1000,
      ttl: this.default_ttl > 0 ? this.default_ttl : 0,
      ttlAutopurge: true,
      // Keep updateAgeOnGet for recency/LRU position; we additionally renew TTL in get() for sliding expiration.
      updateAgeOnGet: opts.update_age_on_get ?? true,
      allowStale: opts.allow_stale ?? false,
      dispose: (value: V, key: K, reason: any) => {
        try {
          opts.on_evict?.(key as unknown, value as unknown, reason);
        } catch {
          // swallow logging errors from on_evict
        }
      }
    });
  }

  get(key: K): V | undefined {
    const val = this.lru.get(key);
    // Sliding TTL: renew on get if configured and we have a default TTL
    if (val !== undefined && (this.opts.update_age_on_get ?? true) && this.default_ttl > 0) {
      this.lru.set(key, val, { ttl: this.default_ttl });
    }
    return val;
  }

  set(key: K, value: V, ttl_ms?: number): void {
    const ttl = typeof ttl_ms === "number" ? ttl_ms : this.default_ttl;
    this.lru.set(key, value, ttl > 0 ? { ttl } : undefined);
  }

  has(key: K): boolean {
    return this.lru.has(key);
  }

  delete(key: K): boolean {
    return this.lru.delete(key);
  }

  clear(): void {
    this.lru.clear();
  }

  stats(): { size: number } {
    return { size: this.lru.size };
  }

  async getOrCompute(key: K, compute: () => Promise<V> | V, ttl_ms?: number): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const p = Promise.resolve().then(compute);
    this.pending.set(key, p);
    try {
      const value = await p;
      this.set(key, value, ttl_ms);
      return value;
    } finally {
      this.pending.delete(key);
    }
  }
}
