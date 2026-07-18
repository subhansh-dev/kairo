/**
 * Sleep — sleep/wait utilities.
 */

/**
 * Sleep for a specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sleep with a progress callback.
 */
export function sleepWithProgress(ms: number, onProgress: (elapsed: number, total: number) => void): Promise<void> {
  return new Promise(resolve => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      onProgress(elapsed, ms);
      if (elapsed >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

/**
 * Wait for a condition to be true.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const { timeoutMs = 30000, intervalMs = 100 } = opts;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await condition()) return true;
    await sleep(intervalMs);
  }

  return false;
}

/**
 * Format a duration for display.
 */
export function formatSleepDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
