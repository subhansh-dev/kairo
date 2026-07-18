/**
 * Lockfile — file locking utilities.
 */

import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';

export interface LockOptions {
  timeout?: number;
  retryInterval?: number;
}

/**
 * Acquire a file lock.
 */
export async function acquireLock(lockPath: string, opts: LockOptions = {}): Promise<{ release: () => void }> {
  const { timeout = 30000, retryInterval = 100 } = opts;
  const start = Date.now();

  while (true) {
    if (!existsSync(lockPath)) {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), 'utf-8');
      return {
        release: () => {
          try { unlinkSync(lockPath); } catch { /* ok */ }
        },
      };
    }

    // Check for stale lock
    try {
      const lockData = JSON.parse(readFileSync(lockPath, 'utf-8'));
      if (Date.now() - lockData.acquiredAt > 60000) {
        // Stale lock — remove it
        unlinkSync(lockPath);
        continue;
      }
    } catch {
      // Invalid lock file — remove it
      try { unlinkSync(lockPath); } catch { /* ok */ }
      continue;
    }

    if (Date.now() - start > timeout) {
      throw new Error(`Failed to acquire lock ${lockPath} after ${timeout}ms`);
    }

    await new Promise(resolve => setTimeout(resolve, retryInterval));
  }
}

/**
 * Check if a lock is held.
 */
export function isLocked(lockPath: string): boolean {
  return existsSync(lockPath);
}

/**
 * Release a lock.
 */
export function releaseLock(lockPath: string): void {
  try { unlinkSync(lockPath); } catch { /* ok */ }
}
