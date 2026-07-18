/**
 * Logs — log management utilities.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.kairo', 'logs');

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
}

/**
 * Get recent log entries.
 */
export function getRecentLogs(limit = 50, level?: string): LogEntry[] {
  if (!existsSync(LOG_DIR)) return [];

  try {
    const files = readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();

    const entries: LogEntry[] = [];
    for (const file of files) {
      if (entries.length >= limit) break;
      const content = readFileSync(join(LOG_DIR, file), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines.reverse()) {
        if (entries.length >= limit) break;
        try {
          const entry = JSON.parse(line);
          if (level && entry.level !== level) continue;
          entries.push(entry);
        } catch {
          // Non-JSON line
          entries.push({ timestamp: '', level: 'info', message: line });
        }
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Format log entries for display.
 */
export function formatLogs(entries: LogEntry[]): string {
  if (entries.length === 0) return 'No logs found.';

  const levelColors: Record<string, string> = {
    error: '\x1b[31m',
    warn: '\x1b[33m',
    info: '\x1b[36m',
    debug: '\x1b[2m',
  };
  const R = '\x1b[0m';

  return entries.map(e => {
    const color = levelColors[e.level] || '';
    const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
    return `${color}[${e.level.toUpperCase()}]${R} ${time} ${e.message}`;
  }).join('\n');
}

/**
 * Clear old logs (keep last N days).
 */
export function clearOldLogs(keepDays = 7): number {
  if (!existsSync(LOG_DIR)) return 0;

  try {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
    let cleared = 0;

    for (const file of files) {
      const stat = statSync(join(LOG_DIR, file));
      if (stat.mtimeMs < cutoff) {
        const { unlinkSync } = require('fs');
        unlinkSync(join(LOG_DIR, file));
        cleared++;
      }
    }

    return cleared;
  } catch {
    return 0;
  }
}
