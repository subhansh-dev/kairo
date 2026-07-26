/**
 * Kairo — Telemetry (Kairo-native rewrite)
 *
 * Optional usage telemetry (disabled by default).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const TELEMETRY_DIR = join(homedir(), '.kairo', 'telemetry')
const TELEMETRY_FILE = join(TELEMETRY_DIR, 'events.jsonl')
const CONFIG_FILE = join(homedir(), '.kairo', 'config.json')

interface TelemetryEvent {
  timestamp: string
  event: string
  properties?: Record<string, unknown>
}

function isEnabled(): boolean {
  try {
    if (!existsSync(CONFIG_FILE)) return false
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    return config.telemetry === true
  } catch {
    return false
  }
}

function ensureDir(): void {
  if (!existsSync(TELEMETRY_DIR)) mkdirSync(TELEMETRY_DIR, { recursive: true })
}

/**
 * Track an analytics event (no-op if telemetry is disabled)
 */
export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!isEnabled()) return

  try {
    ensureDir()
    const entry: TelemetryEvent = {
      timestamp: new Date().toISOString(),
      event,
      properties,
    }
    writeFileSync(TELEMETRY_FILE, JSON.stringify(entry) + '\n', { flag: 'a' })
  } catch {
    // Silently fail
  }
}

/**
 * Track tool usage
 */
export function trackToolUse(toolName: string, success: boolean, durationMs: number): void {
  trackEvent('tool_use', { tool: toolName, success, duration: durationMs })
}

/**
 * Track session start
 */
export function trackSessionStart(model: string, provider: string): void {
  trackEvent('session_start', { model, provider })
}

/**
 * Track compaction
 */
export function trackCompaction(tokensBefore: number, tokensAfter: number, strategy: string): void {
  trackEvent('compaction', { tokensBefore, tokensAfter, strategy, saved: tokensBefore - tokensAfter })
}

/**
 * Track error
 */
export function trackError(error: string, context?: string): void {
  trackEvent('error', { error, context })
}
