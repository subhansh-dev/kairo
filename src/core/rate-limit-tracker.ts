/**
 * Kairo — Rate Limit Tracker
 * Track per-provider rate limits and compute backoff.
 * Ported from Hermes Agent's rate_limit_tracker.py
 */

import { jitteredBackoff } from './retry-utils.js';

interface ProviderState {
  requests: number;
  tokens: number;
  resetAt: number;
  backoffMs: number;
  lastRequest: number;
}

export class RateLimitTracker {
  private providers = new Map<string, ProviderState>();

  private getState(provider: string): ProviderState {
    let state = this.providers.get(provider);
    if (!state) {
      state = { requests: 0, tokens: 0, resetAt: 0, backoffMs: 0, lastRequest: 0 };
      this.providers.set(provider, state);
    }
    return state;
  }

  /**
   * Record a request to a provider.
   */
  recordRequest(provider: string, tokens: number = 0): void {
    const state = this.getState(provider);
    state.requests++;
    state.tokens += tokens;
    state.lastRequest = Date.now();
  }

  /**
   * Get the backoff delay for a provider (0 if no backoff needed).
   */
  getBackoff(provider: string): number {
    const state = this.getState(provider);
    if (state.backoffMs <= 0) return 0;

    const elapsed = Date.now() - state.lastRequest;
    if (elapsed >= state.backoffMs) {
      state.backoffMs = 0;
      return 0;
    }
    return state.backoffMs - elapsed;
  }

  /**
   * Set a backoff for a provider (e.g., after a 429).
   */
  setBackoff(provider: string, ms: number): void {
    const state = this.getState(provider);
    state.backoffMs = Math.max(state.backoffMs, ms);
  }

  /**
   * Handle a rate limit error.
   */
  handleRateLimit(provider: string, retryAfterMs?: number): void {
    const state = this.getState(provider);
    const backoff = retryAfterMs || jitteredBackoff(state.requests + 1);
    state.backoffMs = backoff;
  }

  /**
   * Reset a provider's state (e.g., after successful request).
   */
  reset(provider: string): void {
    const state = this.getState(provider);
    state.requests = 0;
    state.tokens = 0;
    state.backoffMs = 0;
  }

  /**
   * Get status for all providers.
   */
  getStatus(): Record<string, { requests: number; tokens: number; backoffMs: number }> {
    const result: Record<string, any> = {};
    for (const [name, state] of this.providers) {
      result[name] = {
        requests: state.requests,
        tokens: state.tokens,
        backoffMs: state.backoffMs,
      };
    }
    return result;
  }
}

// Singleton
let tracker: RateLimitTracker | null = null;

export function getRateLimitTracker(): RateLimitTracker {
  if (!tracker) tracker = new RateLimitTracker();
  return tracker;
}
