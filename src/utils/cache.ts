/**
 * Kairo — Cache Utilities (Kairo-native rewrite)
 *
 * Simple in-memory cache with TTL support.
 */

export interface CacheOptions {
  ttl: number // Time to live in milliseconds
  maxSize: number // Maximum number of entries
}

const DEFAULT_OPTIONS: CacheOptions = {
  ttl: 60000, // 1 minute
  maxSize: 1000,
}

export class Cache<T> {
  private store = new Map<string, { value: T; expires: number }>()
  private options: CacheOptions

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expires) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    // Evict oldest if at capacity
    if (this.store.size >= this.options.maxSize) {
      const firstKey = this.store.keys().next().value
      if (firstKey) this.store.delete(firstKey)
    }
    this.store.set(key, {
      value,
      expires: Date.now() + this.options.ttl,
    })
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  delete(key: string): boolean {
    return this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  size(): number {
    // Clean expired entries
    const now = Date.now()
    for (const [key, entry] of this.store) {
      if (now > entry.expires) this.store.delete(key)
    }
    return this.store.size
  }

  keys(): string[] {
    return Array.from(this.store.keys())
  }

  values(): T[] {
    return Array.from(this.store.values()).map(e => e.value)
  }
}

/**
 * Create a memoize wrapper for async functions
 */
export function memoizeAsync<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  keyFn: (...args: TArgs) => string,
  options: Partial<CacheOptions> = {},
): (...args: TArgs) => Promise<TResult> {
  const cache = new Cache<TResult>(options)
  return async (...args: TArgs): Promise<TResult> => {
    const key = keyFn(...args)
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const result = await fn(...args)
    cache.set(key, result)
    return result
  }
}

/**
 * Create a memoize wrapper for sync functions
 */
export function memoize<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  keyFn: (...args: TArgs) => string,
  options: Partial<CacheOptions> = {},
): (...args: TArgs) => TResult {
  const cache = new Cache<TResult>(options)
  return (...args: TArgs): TResult => {
    const key = keyFn(...args)
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const result = fn(...args)
    cache.set(key, result)
    return result
  }
}
