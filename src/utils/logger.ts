/**
 * Kairo — Logger (Kairo-native rewrite)
 *
 * Structured logging with levels and output targets.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LOG_DIR = join(homedir(), '.kairo', 'logs')

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
}

class Logger {
  private level: LogLevel = 'info'
  private logToFile = false
  private logFile: string = ''

  setLevel(level: LogLevel): void {
    this.level = level
  }

  enableFileLogging(sessionId: string): void {
    ensureLogDir()
    this.logToFile = true
    this.logFile = join(LOG_DIR, `${sessionId}.log`)
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level]
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString()
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`
    let formatted = `${prefix} ${message}`
    if (data !== undefined) {
      formatted += ` ${JSON.stringify(data)}`
    }
    return formatted
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return

    const formatted = this.formatMessage(level, message, data)

    // Console output
    switch (level) {
      case 'debug':
        if (process.env.KAIRO_DEBUG) console.error(formatted)
        break
      case 'info':
        // Info goes to stderr to not interfere with tool output
        console.error(formatted)
        break
      case 'warn':
        console.error(formatted)
        break
      case 'error':
        console.error(formatted)
        break
    }

    // File output
    if (this.logToFile && this.logFile) {
      try {
        appendFileSync(this.logFile, formatted + '\n')
      } catch {}
    }
  }

  debug(message: string, data?: unknown): void { this.write('debug', message, data) }
  info(message: string, data?: unknown): void { this.write('info', message, data) }
  warn(message: string, data?: unknown): void { this.write('warn', message, data) }
  error(message: string, data?: unknown): void { this.write('error', message, data) }

  /**
   * Create a child logger with a prefix
   */
  child(prefix: string): Logger {
    const child = new Logger()
    child.level = this.level
    child.logToFile = this.logToFile
    child.logFile = this.logFile
    const originalWrite = child.write.bind(child)
    child.write = (level: LogLevel, message: string, data?: unknown) => {
      originalWrite(level, `[${prefix}] ${message}`, data)
    }
    return child
  }
}

// Singleton logger
export const logger = new Logger()

// Convenience functions
export function logDebug(message: string, data?: unknown): void { logger.debug(message, data) }
export function logInfo(message: string, data?: unknown): void { logger.info(message, data) }
export function logWarn(message: string, data?: unknown): void { logger.warn(message, data) }
export function logError(message: string, data?: unknown): void { logger.error(message, data) }

/**
 * Log for debugging (only in debug mode)
 */
export function logForDebugging(...args: unknown[]): void {
  if (process.env.KAIRO_DEBUG) {
    console.error('[kairo-debug]', ...args)
  }
}
