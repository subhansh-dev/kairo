/**
 * Persistent multi-credential pool for same-provider failover.
 *
 * Manages multiple API keys per provider with rotation, cooldown, and status tracking.
 */

export type CredentialStatus = 'ok' | 'exhausted' | 'cooldown' | 'dead';

export interface CredentialEntry {
  key: string;
  status: CredentialStatus;
  lastUsed: number;
  lastError?: string;
  cooldownUntil?: number;
  requestCount: number;
  errorCount: number;
}

export interface ProviderPool {
  provider: string;
  credentials: CredentialEntry[];
  currentIndex: number;
}

// In-memory credential pool (file-backed in production)
const pools = new Map<string, ProviderPool>();

/**
 * Get or create a credential pool for a provider.
 */
export function getPool(provider: string): ProviderPool {
  if (!pools.has(provider)) {
    pools.set(provider, {
      provider,
      credentials: [],
      currentIndex: 0,
    });
  }
  return pools.get(provider)!;
}

/**
 * Add a credential to a provider's pool.
 */
export function addCredential(provider: string, key: string): void {
  const pool = getPool(provider);
  if (pool.credentials.some(c => c.key === key)) return; // already exists
  pool.credentials.push({
    key,
    status: 'ok',
    lastUsed: 0,
    requestCount: 0,
    errorCount: 0,
  });
}

/**
 * Get the next available credential for a provider.
 * Rotates through credentials, skipping those in cooldown or dead.
 */
export function getNextCredential(provider: string): CredentialEntry | null {
  const pool = getPool(provider);
  if (pool.credentials.length === 0) return null;

  const now = Date.now();
  const startIdx = pool.currentIndex;

  for (let i = 0; i < pool.credentials.length; i++) {
    const idx = (startIdx + i) % pool.credentials.length;
    const cred = pool.credentials[idx];

    // Skip dead credentials
    if (cred.status === 'dead') continue;

    // Skip credentials in cooldown
    if (cred.cooldownUntil && cred.cooldownUntil > now) continue;

    // Mark as used
    cred.lastUsed = now;
    cred.requestCount++;
    pool.currentIndex = (idx + 1) % pool.credentials.length;

    return cred;
  }

  return null; // all credentials exhausted or in cooldown
}

/**
 * Mark a credential as rate-limited (429).
 * Sets a cooldown period.
 */
export function markRateLimited(provider: string, key: string, cooldownMs = 60_000): void {
  const pool = getPool(provider);
  const cred = pool.credentials.find(c => c.key === key);
  if (!cred) return;

  cred.status = 'cooldown';
  cred.cooldownUntil = Date.now() + cooldownMs;
  cred.lastError = 'rate_limited';
}

/**
 * Mark a credential as failed.
 */
export function markFailed(provider: string, key: string, error: string): void {
  const pool = getPool(provider);
  const cred = pool.credentials.find(c => c.key === key);
  if (!cred) return;

  cred.errorCount++;
  cred.lastError = error;

  // Mark as dead after too many failures
  if (cred.errorCount >= 5) {
    cred.status = 'dead';
  }
}

/**
 * Mark a credential as successful.
 */
export function markSuccess(provider: string, key: string): void {
  const pool = getPool(provider);
  const cred = pool.credentials.find(c => c.key === key);
  if (!cred) return;

  cred.status = 'ok';
  cred.cooldownUntil = undefined;
  cred.lastError = undefined;
}

/**
 * Get pool status for display.
 */
export function getPoolStatus(provider: string): {
  total: number;
  available: number;
  cooldown: number;
  dead: number;
} {
  const pool = getPool(provider);
  const now = Date.now();
  let available = 0, cooldown = 0, dead = 0;

  for (const cred of pool.credentials) {
    if (cred.status === 'dead') { dead++; continue; }
    if (cred.cooldownUntil && cred.cooldownUntil > now) { cooldown++; continue; }
    available++;
  }

  return {
    total: pool.credentials.length,
    available,
    cooldown,
    dead,
  };
}

/**
 * Reset all pools (for testing).
 */
export function resetPools(): void {
  pools.clear();
}
