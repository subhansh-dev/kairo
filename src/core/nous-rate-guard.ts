/**
 * Cross-session rate limit guard.
 *
 * Writes rate limit state to a shared file so all sessions can check
 * whether the provider is currently rate-limited before making requests.
 * Prevents retry amplification when RPH is tapped.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STATE_DIR = join(homedir(), '.kairo', 'rate_limits');
const STATE_FILE = join(STATE_DIR, 'provider.json');

interface RateLimitState {
  provider: string;
  limitedUntil: number; // epoch ms
  cooldownSeconds: number;
  recordedAt: number;
  reason?: string;
}

/**
 * Get the rate limit state file path.
 */
function getStatePath(): string {
  return STATE_FILE;
}

/**
 * Load rate limit state from disk.
 */
function loadState(): Record<string, RateLimitState> {
  try {
    const path = getStatePath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch { /* ok */ }
  return {};
}

/**
 * Save rate limit state to disk.
 */
function saveState(state: Record<string, RateLimitState>): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(getStatePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Record that a provider is rate-limited.
 */
export function recordRateLimit(opts: {
  provider: string;
  cooldownSeconds?: number;
  reason?: string;
  retryAfterSeconds?: number;
}): void {
  const state = loadState();
  const cooldown = opts.retryAfterSeconds || opts.cooldownSeconds || 300;
  state[opts.provider] = {
    provider: opts.provider,
    limitedUntil: Date.now() + cooldown * 1000,
    cooldownSeconds: cooldown,
    recordedAt: Date.now(),
    reason: opts.reason,
  };
  saveState(state);
}

/**
 * Check if a provider is currently rate-limited.
 * Returns the remaining cooldown in seconds, or 0 if not limited.
 */
export function getRateLimitCooldown(provider: string): number {
  const state = loadState();
  const entry = state[provider];
  if (!entry) return 0;

  const remaining = entry.limitedUntil - Date.now();
  if (remaining <= 0) {
    // Cooldown expired — clean up
    delete state[provider];
    saveState(state);
    return 0;
  }

  return Math.ceil(remaining / 1000);
}

/**
 * Check if a provider is currently rate-limited.
 */
export function isRateLimited(provider: string): boolean {
  return getRateLimitCooldown(provider) > 0;
}

/**
 * Clear rate limit state for a provider.
 */
export function clearRateLimit(provider: string): void {
  const state = loadState();
  delete state[provider];
  saveState(state);
}

/**
 * Clear all rate limit states.
 */
export function clearAllRateLimits(): void {
  saveState({});
}

/**
 * Get a user-facing message about the rate limit.
 */
export function getRateLimitMessage(provider: string): string | null {
  const cooldown = getRateLimitCooldown(provider);
  if (cooldown <= 0) return null;
  return `⚠️ ${provider} is rate-limited. Retry in ${cooldown}s`;
}
