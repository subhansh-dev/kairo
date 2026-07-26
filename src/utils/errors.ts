/**
 * Kairo — Error Utilities
 * Minimal implementation for kairo
 */

export class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

export function hasExactErrorMessage(error: unknown, message: string): boolean {
  if (error instanceof Error) return error.message === message
  return false
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
