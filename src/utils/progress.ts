/**
 * Kairo — Progress Utilities (Kairo-native rewrite)
 *
 * Progress indicators for long-running operations.
 */

export interface ProgressBar {
  total: number
  current: number
  width: number
  label: string
}

/**
 * Create a progress bar string
 */
export function createProgressBar(options: Partial<ProgressBar> = {}): string {
  const { total = 100, current = 0, width = 30, label = '' } = options
  const percent = Math.min(1, Math.max(0, current / total))
  const filled = Math.round(width * percent)
  const empty = width - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  const percentStr = Math.round(percent * 100).toString().padStart(3)
  return `${label} [${bar}] ${percentStr}%`
}

/**
 * Create a spinner string
 */
export function createSpinner(frame: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  return frames[frame % frames.length]
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
}

/**
 * Format bytes in human-readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Format number with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString()
}

/**
 * Create a countdown string
 */
export function createCountdown(targetMs: number): string {
  const now = Date.now()
  const remaining = Math.max(0, targetMs - now)
  return formatDuration(remaining)
}
