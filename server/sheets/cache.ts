import { logger } from '../logger.js';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Small TTL cache with explicit invalidation.
 *
 * Reads are served from memory so the dashboard, board and reports do not each
 * hit the spreadsheet. Every write invalidates the sheets it touched, so the
 * cache can never serve data older than our own last write; the TTL only
 * guards against somebody editing the workbook by hand.
 */
export class TtlCache {
  private readonly store = new Map<string, Entry<unknown>>();
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(ttlSeconds: number) {
    this.ttlMs = Math.max(0, ttlSeconds) * 1000;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMsOverride?: number): void {
    const ttl = ttlMsOverride ?? this.ttlMs;
    if (ttl <= 0) return;
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
    logger.debug('Cache cleared', { hits: this.hits, misses: this.misses });
  }

  stats(): { size: number; hits: number; misses: number } {
    return { size: this.store.size, hits: this.hits, misses: this.misses };
  }
}
