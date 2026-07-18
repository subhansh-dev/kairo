/**
 * Rate limit tracker — per-provider rate limit state.
 *
 * Tracks rate limits across providers with backoff computation.
 */

export interface RateLimitEntry {
  provider: string;
  limitedAt: number;
  retryAfterMs: number;
  requestCount: number;
  lastRequestAt: number;
}

// Per-provider rate limit state
const rateLimits = new Map<string, RateLimitEntry>();

/**
 * Record a rate limit for a provider.
 */
export function recordRateLimit(provider: string, retryAfterMs: number): void {
  rateLimits.set(provider, {
    provider,
    limitedAt: Date.now(),
    retryAfterMs,
    requestCount: (rateLimits.get(provider)?.requestCount || 0) + 1,
    lastRequestAt: Date.now(),
  });
}

/**
 * Record a successful request for a provider.
 */
export function recordRequest(provider: string): void {
  const existing = rateLimits.get(provider);
  if (existing) {
    existing.requestCount++;
    existing.lastRequestAt = Date.now();
  } else {
    rateLimits.set(provider, {
      provider,
      limitedAt: 0,
      retryAfterMs: 0,
      requestCount: 1,
      lastRequestAt: Date.now(),
    });
  }
}

/**
 * Get the backoff time for a provider (0 if not rate-limited).
 */
export function getBackoff(provider: string): number {
  const entry = rateLimits.get(provider);
  if (!entry || entry.limitedAt === 0) return 0;

  const elapsed = Date.now() - entry.limitedAt;
  const remaining = entry.retryAfterMs - elapsed;
  return remaining > 0 ? remaining : 0;
}

/**
 * Check if a provider is currently rate-limited.
 */
export function isRateLimited(provider: string): boolean {
  return getBackoff(provider) > 0;
}

/**
 * Clear rate limit state for a provider.
 */
export function clearRateLimit(provider: string): void {
  rateLimits.delete(provider);
}

/**
 * Clear all rate limit states.
 */
export function clearAllRateLimits(): void {
  rateLimits.clear();
}

/**
 * Get rate limit status for all providers.
 */
export function getRateLimitStatus(): Record<string, { limited: boolean; backoffMs: number; requests: number }> {
  const status: Record<string, { limited: boolean; backoffMs: number; requests: number }> = {};
  for (const [provider, entry] of rateLimits) {
    status[provider] = {
      limited: isRateLimited(provider),
      backoffMs: getBackoff(provider),
      requests: entry.requestCount,
    };
  }
  return status;
}

/**
 * Compute exponential backoff for a retry attempt.
 */
export function computeBackoff(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const backoff = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  // Add jitter (±25%)
  const jitter = backoff * 0.25 * (Math.random() * 2 - 1);
  return Math.round(backoff + jitter);
}
