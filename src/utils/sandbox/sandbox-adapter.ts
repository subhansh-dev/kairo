/**
 * Kairo — Sandbox Adapter (Stub)
 * Kairo doesn't use sandboxing — all operations run directly
 */

export class SandboxManager {
  static isSandboxingEnabled(): boolean {
    return false
  }

  static isAutoAllowBashIfSandboxedEnabled(): boolean {
    return false
  }

  static getFsWriteConfig(): { allowOnly: string[]; denyWithinAllow: string[] } {
    return { allowOnly: [], denyWithinAllow: [] }
  }
}
