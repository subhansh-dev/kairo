/**
 * Kairo — Credential Pool with Failover + Persistence
 * Persists cooldown state to ~/.kairo/credentials.json across restarts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { ProviderError } from './types.js';

const PERSIST_PATH = join(homedir(), '.kairo', 'credentials.json');

interface PersistedCredential {
  key: string;
  provider: string;
  failCount: number;
  lastFail: number;
  cooldownUntil: number;
}

interface PersistedState {
  credentials: PersistedCredential[];
  savedAt: number;
}

interface PoolConfig {
  maxFailures: number;
  cooldownMs: number;
  resetAfterMs: number;
}

const DEFAULT_CONFIG: PoolConfig = {
  maxFailures: 3,
  cooldownMs: 60000,      // 1 minute cooldown after max failures
  resetAfterMs: 300000,   // 5 minutes to reset failure count
};

export class CredentialPool {
  private credentials = new Map<string, PersistedCredential[]>();
  private config: PoolConfig;
  private persistPath: string;
  private dirty = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<PoolConfig> = {}, persistPath?: string) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.persistPath = persistPath ?? PERSIST_PATH;
  }

  /**
   * Load persisted state from disk
   */
  load(): void {
    try {
      if (!existsSync(this.persistPath)) return;
      const raw = readFileSync(this.persistPath, 'utf-8');
      const state: PersistedState = JSON.parse(raw);
      this.credentials.clear();
      for (const pc of state.credentials) {
        const list = this.credentials.get(pc.provider) || [];
        list.push(pc);
        this.credentials.set(pc.provider, list);
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

  /**
   * Persist current state to disk (debounced)
   */
  private schedulePersist(): void {
    this.dirty = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.flush();
    }, 2000);
  }

  /**
   * Force immediate persist
   */
  private flush(): void {
    if (!this.dirty) return;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      const allCreds: PersistedCredential[] = [];
      for (const creds of this.credentials.values()) {
        allCreds.push(...creds);
      }
      const state: PersistedState = { credentials: allCreds, savedAt: Date.now() };
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(state, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // Best-effort persistence
    }
  }

  /**
   * Add a credential to the pool
   */
  add(provider: string, key: string): void {
    // Validate key — reject if empty, too short, or contains non-ASCII
    if (!key || key.length < 10) return;
    for (let i = 0; i < key.length; i++) {
      if (key.charCodeAt(i) > 127) return;
    }

    // Don't re-add duplicates
    const existing = this.credentials.get(provider);
    if (existing && existing.some(c => c.key === key)) return;

    if (!existing) {
      this.credentials.set(provider, []);
    }
    this.credentials.get(provider)!.push({
      key,
      provider,
      failCount: 0,
      lastFail: 0,
      cooldownUntil: 0,
    });
  }

  /**
   * Get the best available credential for a provider
   * Returns null if all credentials are in cooldown
   */
  get(provider: string): string | null {
    const creds = this.credentials.get(provider);
    if (!creds || creds.length === 0) return null;

    const now = Date.now();

    // Reset failure counts for credentials that have been cooling long enough
    let changed = false;
    for (const cred of creds) {
      if (cred.failCount > 0 && now - cred.lastFail > this.config.resetAfterMs) {
        cred.failCount = 0;
        cred.cooldownUntil = 0;
        changed = true;
      }
    }
    if (changed) this.schedulePersist();

    // Find first available credential (not in cooldown)
    for (const cred of creds) {
      if (now >= cred.cooldownUntil) {
        return cred.key;
      }
    }

    return null;
  }

  /**
   * Report a failure for a credential
   */
  reportFailure(provider: string, key: string, error: ProviderError): void {
    const creds = this.credentials.get(provider);
    if (!creds) return;

    const cred = creds.find(c => c.key === key);
    if (!cred) return;

    cred.failCount++;
    cred.lastFail = Date.now();

    if (cred.failCount >= this.config.maxFailures || error.shouldRotate) {
      cred.cooldownUntil = Date.now() + this.config.cooldownMs;
    }

    this.schedulePersist();
  }

  /**
   * Report a success (resets failure count)
   */
  reportSuccess(provider: string, key: string): void {
    const creds = this.credentials.get(provider);
    if (!creds) return;

    const cred = creds.find(c => c.key === key);
    if (!cred) return;

    cred.failCount = 0;
    cred.cooldownUntil = 0;
    this.schedulePersist();
  }

  /**
   * Get status of all credentials
   */
  getStatus(): Record<string, { total: number; available: number; cooldown: number }> {
    const now = Date.now();
    const status: Record<string, { total: number; available: number; cooldown: number }> = {};

    for (const [provider, creds] of this.credentials) {
      status[provider] = {
        total: creds.length,
        available: creds.filter(c => now >= c.cooldownUntil).length,
        cooldown: creds.filter(c => now < c.cooldownUntil).length,
      };
    }

    return status;
  }
}

// Global pool instance
let _pool: CredentialPool | null = null;

export function getCredentialPool(): CredentialPool {
  if (!_pool) {
    _pool = new CredentialPool();
    _pool.load();
  }
  return _pool;
}
