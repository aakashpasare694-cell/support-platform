import { Redis } from '@upstash/redis'
import type { Config } from '@/config/index.ts'

/**
 * Cache and counters.
 *
 * Upstash over REST, because an HTTP client behaves identically in both
 * runtimes — there is no TCP Redis client to adapt for Workers. When Upstash is
 * not configured (the usual local case) an in-memory implementation takes over,
 * which is correct for a single Node process and useless across instances. That
 * is the right trade for local development and wrong for production, so
 * `assertUsableConfig` should require it there once rate limiting matters.
 */
export interface CacheLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  del(key: string): Promise<void>
  /** Increments and returns the new value, setting the TTL on first write. */
  incr(key: string, ttlSeconds: number): Promise<number>
}

class MemoryCache implements CacheLike {
  private store = new Map<string, { value: string; expiresAt: number }>()

  private live(key: string) {
    const hit = this.store.get(key)
    if (!hit) return null
    if (hit.expiresAt && hit.expiresAt < Date.now()) {
      this.store.delete(key)
      return null
    }
    return hit
  }

  async get(key: string) {
    return this.live(key)?.value ?? null
  }

  async set(key: string, value: string, ttlSeconds = 0) {
    this.store.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 })
  }

  async del(key: string) {
    this.store.delete(key)
  }

  async incr(key: string, ttlSeconds: number) {
    const hit = this.live(key)
    const next = Number(hit?.value ?? 0) + 1
    this.store.set(key, {
      value: String(next),
      expiresAt: hit?.expiresAt || Date.now() + ttlSeconds * 1000,
    })
    return next
  }
}

class UpstashCache implements CacheLike {
  constructor(private redis: Redis, private prefix: string) {}

  private k(key: string) {
    return `${this.prefix}:${key}`
  }

  async get(key: string) {
    const v = await this.redis.get<string>(this.k(key))
    return v ?? null
  }

  async set(key: string, value: string, ttlSeconds = 0) {
    if (ttlSeconds > 0) await this.redis.set(this.k(key), value, { ex: ttlSeconds })
    else await this.redis.set(this.k(key), value)
  }

  async del(key: string) {
    await this.redis.del(this.k(key))
  }

  async incr(key: string, ttlSeconds: number) {
    const full = this.k(key)
    const n = await this.redis.incr(full)
    if (n === 1) await this.redis.expire(full, ttlSeconds)
    return n
  }
}

export function createCache(config: Config): CacheLike {
  if (config.cache.url && config.cache.token) {
    return new UpstashCache(
      new Redis({ url: config.cache.url, token: config.cache.token, automaticDeserialization: false }),
      config.cache.prefix,
    )
  }
  return new MemoryCache()
}

/**
 * Cache-aside that FAILS OPEN: if the cache is unreachable the producer runs
 * anyway. A cache outage should make the app slow, never broken.
 */
export async function remember<T>(
  cache: CacheLike,
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
): Promise<T> {
  try {
    const hit = await cache.get(key)
    if (hit !== null) return JSON.parse(hit) as T
  } catch {
    return producer()
  }
  const value = await producer()
  try {
    await cache.set(key, JSON.stringify(value), ttlSeconds)
  } catch {
    // Losing the write is survivable; losing the response is not.
  }
  return value
}
