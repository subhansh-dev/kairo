/**
 * Kairo — Debug Utility (Stub)
 */

export function logForDebugging(...args: unknown[]): void {
  if (process.env.KAIRO_DEBUG) {
    console.error('[kairo-debug]', ...args)
  }
}
