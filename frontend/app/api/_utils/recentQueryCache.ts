export interface RecentQueryCacheOptions {
  maxEntries: number;
  defaultTtlMs: number;
  now?: () => number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple in-memory LRU + TTL cache intended for client-side request/result caching.
 *
 * - LRU eviction via Map insertion order
 * - TTL expiration checked on read
 * - In-flight de-duping to prevent parallel identical requests
 */
export class RecentQueryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  constructor(options: RecentQueryCacheOptions) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.defaultTtlMs = Math.max(0, options.defaultTtlMs);
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    const now = this.now();
    if (now > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh LRU order by re-inserting.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const ttl = Math.max(0, ttlMs ?? this.defaultTtlMs);
    const now = this.now();

    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, { value, expiresAt: now + ttl });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
    this.inflight.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  size(): number {
    return this.entries.size;
  }

  async getOrCreate(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const inflight = this.inflight.get(key);
    if (inflight) {
      return inflight;
    }

    const promise = (async () => {
      const value = await fetcher();
      this.set(key, value, ttlMs);
      return value;
    })();

    this.inflight.set(key, promise);
    void promise
      .finally(() => {
        if (this.inflight.get(key) === promise) {
          this.inflight.delete(key);
        }
      })
      .catch(() => {
        // Prevent unhandled rejections from the detached finally-chain.
      });

    return promise;
  }
}

