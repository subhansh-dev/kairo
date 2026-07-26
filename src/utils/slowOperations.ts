/**
 * Kairo — Slow Operations Utilities (Stub)
 */

export function jsonStringify(arg: unknown): string {
  try { return JSON.stringify(arg) } catch { return String(arg) }
}

export function jsonParse<T = unknown>(text: string): T | null {
  try { return JSON.parse(text) as T } catch { return null }
}
