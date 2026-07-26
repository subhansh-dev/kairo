/**
 * Kairo — Throttle Utilities (Kairo-native rewrite)
 *
 * Throttle and debounce function calls.
 */

/**
 * Throttle a function — calls at most once per interval
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  interval: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    const now = Date.now()
    const timeSinceLastCall = now - lastCall

    if (timeSinceLastCall >= interval) {
      lastCall = now
      fn(...args)
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now()
        timeoutId = null
        fn(...args)
      }, interval - timeSinceLastCall)
    }
  }
}

/**
 * Debounce a function — delays until after interval of inactivity
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  interval: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      timeoutId = null
      fn(...args)
    }, interval)
  }
}

/**
 * Debounce async function — returns a promise
 */
export function debounceAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  interval: number,
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let resolvePromise: ((value: ReturnType<T>) => void) | null = null

  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return new Promise(resolve => {
      resolvePromise = resolve
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(async () => {
        timeoutId = null
        const result = await fn(...args) as ReturnType<T>
        resolvePromise?.(result)
      }, interval)
    })
  }
}

/**
 * Rate limiter — allows at most N calls per interval
 */
export class RateLimiter {
  private calls: number[] = []

  constructor(
    private maxCalls: number,
    private interval: number,
  ) {}

  tryAcquire(): boolean {
    const now = Date.now()
    // Remove old calls
    this.calls = this.calls.filter(t => now - t < this.interval)
    if (this.calls.length < this.maxCalls) {
      this.calls.push(now)
      return true
    }
    return false
  }

  timeUntilAvailable(): number {
    if (this.calls.length < this.maxCalls) return 0
    const oldest = this.calls[0]
    return Math.max(0, this.interval - (Date.now() - oldest))
  }

  reset(): void {
    this.calls = []
  }
}
