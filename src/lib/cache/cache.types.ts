export type CacheOptions = {
  max?: number;
  default_ttl_ms?: number;
  allow_stale?: boolean;
  update_age_on_get?: boolean;
  /**
   * Called when an entry is evicted from the cache due to TTL/LRU/etc.
   */
  on_evict?: (key: unknown, value: unknown, reason?: string) => void;
  /**
   * Optional namespace for logs/metrics.
   */
  namespace?: string;
};

export interface Cache<K, V> {
  /**
   * Get a value by key. Returns undefined if not present or expired.
   */
  get(key: K): V | undefined;

  /**
   * Set a value by key with optional TTL override in ms.
   */
  set(key: K, value: V, ttl_ms?: number): void;

  /**
   * Whether the cache contains a non-expired entry for key.
   */
  has(key: K): boolean;

  /**
   * Delete an entry by key. Returns true if the entry existed and was removed.
   */
  delete(key: K): boolean;

  /**
   * Clear all entries.
   */
  clear(): void;

  /**
   * Minimal stats. Extend later if needed.
   */
  stats(): { size: number };

  /**
   * Get from cache or compute and populate.
   * Ensures single-flight per key to avoid duplicate work.
   */
  getOrCompute(key: K, compute: () => Promise<V> | V, ttl_ms?: number): Promise<V>;
}
