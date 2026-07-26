/**
 * Kairo — Retry Utilities (Kairo-native rewrite)
 *
 * Retry logic with exponential backoff.
 */

export interface RetryOptions {
  maxRetries: number
  initialDelay: number
  maxDelay: number
  backoffMultiplier: number
  retryableErrors?: string[]
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: Error | null = null
  let delay = opts.initialDelay

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Check if error is retryable
      if (opts.retryableErrors && opts.retryableErrors.length > 0) {
        const isRetryable = opts.retryableErrors.some(e =>
          lastError!.message.toLowerCase().includes(e.toLowerCase())
        )
        if (!isRetryable) throw lastError
      }

      // Don't wait after last attempt
      if (attempt < opts.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay))
        delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay)
      }
    }
  }

  throw lastError
}

/**
 * Retry with fixed delay
 */
export async function withFixedRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
): Promise<T> {
  return withRetry(fn, {
    maxRetries,
    initialDelay: delay,
    maxDelay: delay,
    backoffMultiplier: 1,
  })
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes('429') ||
      error.message.includes('rate limit') ||
      error.message.includes('too many requests')
    )
  }
  return false
}

/**
 * Get retry delay from error (respects Retry-After header)
 */
export function getRetryDelay(error: unknown, defaultDelay: number = 1000): number {
  if (error instanceof Error) {
    const match = error.message.match(/retry[_-]after[:\s]+(\d+)/i)
    if (match) {
      return parseInt(match[1], 10) * 1000
    }
  }
  return defaultDelay
}
