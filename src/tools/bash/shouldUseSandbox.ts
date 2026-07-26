/**
 * Kairo — Should Use Sandbox
 *
 * Kairo doesn't use sandboxing, so this always returns false.
 */

export function shouldUseSandbox(_input?: unknown): boolean {
  return false
}

export function isAutoAllowBashIfSandboxedEnabled(): boolean {
  return false
}
