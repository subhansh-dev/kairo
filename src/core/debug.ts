/**
 * Debug — debug mode utilities.
 */

let debugMode = false;

/**
 * Enable debug mode.
 */
export function enableDebug(): void {
  debugMode = true;
}

/**
 * Disable debug mode.
 */
export function disableDebug(): void {
  debugMode = false;
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
  return debugMode || process.env.KAIRO_DEBUG === '1';
}

/**
 * Log a debug message (only in debug mode).
 */
export function debugLog(message: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  const timestamp = new Date().toISOString().slice(11, 23);
  console.error(`[DEBUG ${timestamp}] ${message}`, ...args);
}

/**
 * Debug dump an object (only in debug mode).
 */
export function debugDump(label: string, obj: unknown): void {
  if (!isDebugEnabled()) return;
  console.error(`[DEBUG] ${label}:`, JSON.stringify(obj, null, 2));
}

/**
 * Measure and log execution time (only in debug mode).
 */
export async function debugTime<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!isDebugEnabled()) return fn();
  const start = Date.now();
  try {
    const result = await fn();
    debugLog(`${label}: ${Date.now() - start}ms`);
    return result;
  } catch (err) {
    debugLog(`${label}: FAILED after ${Date.now() - start}ms`);
    throw err;
  }
}

/**
 * Get debug info about the current environment.
 */
export function getDebugInfo(): Record<string, unknown> {
  return {
    debugMode: isDebugEnabled(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    pid: process.pid,
  };
}
