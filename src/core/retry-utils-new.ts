/**
 * Retry utilities — jittered backoff for decorrelated retries.
 *
 * Replaces fixed exponential backoff with jittered delays to prevent
 * thundering-herd retry spikes when multiple sessions hit the same
 * rate-limited provider concurrently.
 */

let jitterCounter = 0;

/**
 * Compute a jittered exponential backoff delay.
 *
 * @param attempt 1-based retry attempt number
 * @param baseDelay Base delay in seconds for attempt 1
 * @param maxDelay Maximum delay cap in seconds
 * @param jitterRatio Fraction of computed delay to use as random jitter range
 * @returns Delay in seconds with jitter
 */
export function jitteredBackoff(
  attempt: number,
  opts: {
    baseDelay?: number;
    maxDelay?: number;
    jitterRatio?: number;
  } = {},
): number {
  const { baseDelay = 5.0, maxDelay = 120.0, jitterRatio = 0.5 } = opts;
  jitterCounter++;

  const exponent = Math.max(0, attempt - 1);
  let delay: number;
  if (exponent >= 63 || baseDelay <= 0) {
    delay = maxDelay;
  } else {
    delay = Math.min(baseDelay * Math.pow(2, exponent), maxDelay);
  }

  // Decorrelate jitter using time + counter
  const seed = (Date.now() ^ (jitterCounter * 0x9E3779B9)) >>> 0;
  const jitter = (seed / 0xFFFFFFFF) * jitterRatio * delay;

  return delay + jitter;
}

/**
 * Check if an error is a rate limit (429).
 */
export function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const status = (error as any).status || (error as any).statusCode;
    if (status === 429) return true;
    const msg = String((error as any).message || '').toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit')) return true;
  }
  return false;
}

/**
 * Get a provider-aware rate-limit backoff delay.
 */
export function adaptiveRateLimitBackoff(
  attempt: number,
  opts: {
    provider?: string;
    defaultWait?: number;
    error?: unknown;
  } = {},
): { waitSeconds: number; reason?: string } {
  const { defaultWait = 5.0 } = opts;

  // Default: use jittered backoff
  return {
    waitSeconds: jitteredBackoff(attempt, { baseDelay: defaultWait, maxDelay: 120.0 }),
  };
}

/**
 * Check if an error is retryable (5xx, timeout, connection error).
 */
export function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const status = (error as any).status || (error as any).statusCode;
    if (status && status >= 500) return true;
    const msg = String((error as any).message || '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('econnrefused')) return true;
    if (msg.includes('socket hang up') || msg.includes('connection lost')) return true;
  }
  return false;
}

/**
 * Get the maximum retry count for a provider.
 */
export function getMaxRetries(provider?: string): number {
  // Could be configurable per-provider in the future
  return 3;
}
