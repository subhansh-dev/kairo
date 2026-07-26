/**
 * Kairo — Retry Utilities
 * Jittered backoff for decorrelated retries.
 * Ported from Hermes Agent's retry_utils.py
 *
 * Replaces fixed exponential backoff with jittered delays to prevent
 * thundering-herd retry spikes when multiple sessions hit the same
 * rate-limited provider concurrently.
 */

let jitterCounter = 0;

/**
 * Compute a jittered exponential backoff delay.
 *
 * @param attempt - 1-based retry attempt number
 * @param baseDelay - Base delay in seconds for attempt 1
 * @param maxDelay - Maximum delay cap in seconds
 * @param jitterRatio - Fraction of computed delay to use as random jitter
 * @returns Delay in milliseconds
 */
export function jitteredBackoff(
  attempt: number,
  baseDelay: number = 5.0,
  maxDelay: number = 120.0,
  jitterRatio: number = 0.5,
): number {
  jitterCounter++;
  const exponential = baseDelay * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxDelay);
  const jitter = capped * jitterRatio * seededRandom(jitterCounter + attempt);
  return Math.round((capped + jitter) * 1000);
}

/**
 * Adaptive rate limit backoff.
 * Starts with short retries, then escalates to longer delays.
 */
export function adaptiveRateLimitBackoff(
  attempt: number,
  shortAttempts: number = 3,
  baseDelay: number = 5.0,
): number {
  if (attempt <= shortAttempts) {
    return jitteredBackoff(attempt, baseDelay, 30.0);
  }
  // Long tier: 30s, 60s, 90s, 120s
  const longTier = [30, 60, 90, 120];
  const idx = Math.min(attempt - shortAttempts - 1, longTier.length - 1);
  const base = longTier[idx];
  return jitteredBackoff(1, base, base * 1.5);
}

/**
 * Simple seeded random (0-1). Not cryptographically secure,
 * just needs to be decorrelated across concurrent retries.
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

/**
 * Retry with exponential backoff.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: any) => boolean;
    onRetry?: (attempt: number, delay: number, error: any) => void;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 5.0,
    maxDelay = 120.0,
    shouldRetry = () => true,
    onRetry,
  } = options;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (attempt > maxRetries || !shouldRetry(error)) {
        throw error;
      }

      const delay = jitteredBackoff(attempt, baseDelay, maxDelay);
      if (onRetry) onRetry(attempt, delay, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Max retries exceeded');
}
