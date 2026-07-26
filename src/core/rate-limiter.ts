/**
 * Kairo — Rate Limit Tracker (Unified)
 * Per-provider rate limit tracking with bucket-based throttling,
 * sliding window enforcement, and jittered backoff calculation.
 *
 * This file is the canonical source for rate limit tracking.
 * The duplicate `rate-limit-tracker.ts` has been merged into this file.
 */

import { jitteredBackoff } from './retry-utils.js';

export interface RateLimitBucket {
  remaining: number;
  reset: number;
  limit: number;
  windowMs: number;
}

export interface RateLimitState {
  requestsPerMinute: RateLimitBucket;
  tokensPerMinute: RateLimitBucket;
  requestsPerDay: RateLimitBucket;
}

interface ExplicitBackoffState {
  requests: number;
  tokens: number;
  resetAt: number;
  backoffMs: number;
  lastRequest: number;
}

export class RateLimitTracker {
  private buckets = new Map<string, RateLimitState>();
  private requestLog = new Map<string, number[]>();
  private explicitBackoff = new Map<string, ExplicitBackoffState>();

  /**
   * Parse rate limit headers from provider response
   */
  parseHeaders(provider: string, headers: Record<string, string>): void {
    const state = this.getOrCreate(provider);

    const rLimit = headers['x-ratelimit-limit'] || headers['x-rate-limit-limit'];
    const rRemaining = headers['x-ratelimit-remaining'] || headers['x-rate-limit-remaining'];
    const rReset = headers['x-ratelimit-reset'] || headers['x-ratelimit-reset-epoch'] || headers['x-rate-limit-reset'];

    if (rLimit && rRemaining) {
      state.requestsPerMinute = {
        remaining: parseInt(rRemaining),
        reset: rReset ? parseInt(rReset) : Date.now() + 60000,
        limit: parseInt(rLimit),
        windowMs: 60000,
      };
    }

    const tLimit = headers['x-ratelimit-tokens-limit'] || headers['x-rate-limit-tokens'];
    const tRemaining = headers['x-ratelimit-tokens-remaining'];
    const tReset = headers['x-ratelimit-tokens-reset'];

    if (tLimit && tRemaining) {
      state.tokensPerMinute = {
        remaining: parseInt(tRemaining),
        reset: tReset ? parseInt(tReset) : Date.now() + 60000,
        limit: parseInt(tLimit),
        windowMs: 60000,
      };
    }
  }

  /**
   * Calculate backoff based on rate limit state + explicit backoff + sliding window
   */
  getBackoff(provider: string): number {
    const state = this.buckets.get(provider);
    const explicitState = this.explicitBackoff.get(provider);
    const now = Date.now();
    const backoffs: number[] = [];

    // Check explicit backoff (set via handleRateLimit/setBackoff)
    if (explicitState && explicitState.backoffMs > 0) {
      const elapsed = now - explicitState.lastRequest;
      if (elapsed < explicitState.backoffMs) {
        backoffs.push(explicitState.backoffMs - elapsed);
      } else {
        explicitState.backoffMs = 0;
      }
    }

    // Check bucket-based rate limits
    if (state) {
      if (state.requestsPerMinute.remaining <= 0) {
        const wait = state.requestsPerMinute.reset - now;
        if (wait > 0) backoffs.push(wait);
      }

      if (state.tokensPerMinute.remaining <= 0) {
        const wait = state.tokensPerMinute.reset - now;
        if (wait > 0) backoffs.push(wait);
      }
    }

    // Track recent request timestamps for sliding window
    const log = this.requestLog.get(provider) || [];
    const windowStart = now - 60000;
    const recent = log.filter(t => t > windowStart);
    this.requestLog.set(provider, recent);

    if (recent.length >= 50) {
      backoffs.push(1000);
    }

    return backoffs.length > 0 ? Math.max(...backoffs) + 100 : 0;
  }

  /**
   * Record a request for sliding window tracking
   */
  recordRequest(provider: string, tokens: number = 0): void {
    const log = this.requestLog.get(provider) || [];
    log.push(Date.now());
    this.requestLog.set(provider, log);

    // Update explicit backoff state
    const explicitState = this.explicitBackoff.get(provider);
    if (explicitState) {
      explicitState.requests++;
      explicitState.tokens += tokens;
      explicitState.lastRequest = Date.now();
    }
  }

  /**
   * Set a backoff for a provider (e.g., after a 429).
   */
  setBackoff(provider: string, ms: number): void {
    let state = this.explicitBackoff.get(provider);
    if (!state) {
      state = { requests: 0, tokens: 0, resetAt: 0, backoffMs: 0, lastRequest: 0 };
      this.explicitBackoff.set(provider, state);
    }
    state.backoffMs = Math.max(state.backoffMs, ms);
  }

  /**
   * Handle a rate limit error — computes jittered backoff.
   */
  handleRateLimit(provider: string, retryAfterMs?: number): void {
    const state = this.explicitBackoff.get(provider);
    const attemptCount = state ? state.requests : 0;
    const backoff = retryAfterMs || jitteredBackoff(attemptCount + 1);
    this.setBackoff(provider, backoff);
  }

  /**
   * Reset a provider's state (e.g., after successful request).
   */
  resetProvider(provider: string): void {
    this.buckets.delete(provider);
    this.requestLog.delete(provider);
    this.explicitBackoff.delete(provider);
  }

  /**
   * Check if provider is rate limited right now
   */
  isLimited(provider: string): boolean {
    return this.getBackoff(provider) > 0;
  }

  /**
   * Format rate limit status for display
   */
  formatStatus(): string {
    const lines: string[] = [];
    for (const [provider, state] of this.buckets) {
      const parts: string[] = [provider];
      if (state.requestsPerMinute.limit) {
        parts.push(`req: ${state.requestsPerMinute.remaining}/${state.requestsPerMinute.limit}`);
      }
      if (state.tokensPerMinute.limit) {
        parts.push(`tokens: ${state.tokensPerMinute.remaining}/${state.tokensPerMinute.limit}`);
      }
      lines.push(`  ${parts.join(' | ')}`);
    }
    return lines.length > 0 ? lines.join('\n') : 'No rate limit data.';
  }

  /**
   * Reset all rate limit state (for engine reset)
   */
  reset(): void {
    this.buckets.clear();
    this.requestLog.clear();
    this.explicitBackoff.clear();
  }

  /**
   * Get status for all providers (explicit backoff info).
   */
  getStatus(): Record<string, { requests: number; tokens: number; backoffMs: number }> {
    const result: Record<string, any> = {};
    for (const [name, state] of this.explicitBackoff) {
      result[name] = {
        requests: state.requests,
        tokens: state.tokens,
        backoffMs: state.backoffMs,
      };
    }
    return result;
  }

  private getOrCreate(provider: string): RateLimitState {
    let state = this.buckets.get(provider);
    if (!state) {
      state = {
        requestsPerMinute: { remaining: Infinity, reset: 0, limit: Infinity, windowMs: 60000 },
        tokensPerMinute: { remaining: Infinity, reset: 0, limit: Infinity, windowMs: 60000 },
        requestsPerDay: { remaining: Infinity, reset: 0, limit: Infinity, windowMs: 86400000 },
      };
      this.buckets.set(provider, state);
    }
    return state;
  }
}

const globalTracker = new RateLimitTracker();
export function getRateLimitTracker(): RateLimitTracker {
  return globalTracker;
}
