/**
 * Kairo — Rate Limit Tracker (DEPRECATED — re-export wrapper)
 *
 * All functionality has been merged into `rate-limiter.ts`.
 * This file exists solely for backward compatibility with imports
 * that reference `rate-limit-tracker.js`.
 *
 * DO NOT add new functionality here — use `rate-limiter.ts` instead.
 */

export { RateLimitTracker, getRateLimitTracker } from './rate-limiter.js';
export type { RateLimitBucket, RateLimitState } from './rate-limiter.js';
