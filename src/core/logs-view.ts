/**
 * Logs view — log viewing utilities.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.kairo', 'logs');

export interface LogLine {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source?: string;
  message: string;
}

/**
 * Read the last N log lines.
 */
export function readLastLogLines(limit = 100, level?: string): LogLine[] {
  if (!existsSync(LOG_DIR)) return [];

  try {
    const files = readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();

    const lines: LogLine[] = [];
    for (const file of files) {
      if (lines.length >= limit) break;
      const content = readFileSync(join(LOG_DIR, file), 'utf-8');
      for (const line of content.split('\n').reverse()) {
        if (lines.length >= limit) break;
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (level && parsed.level !== level) continue;
          lines.push(parsed);
        } catch {
          lines.push({ timestamp: '', level: 'info', message: line });
        }
      }
    }

    return lines;
  } catch {
    return [];
  }
}

/**
 * Format log lines for display.
 */
export function formatLogLines(lines: LogLine[]): string {
  if (lines.length === 0) return 'No log entries.';

  const levelColor: Record<string, string> = {
    debug: '\x1b[2m',
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
  };
  const R = '\x1b[0m';

  return lines.map(l => {
    const color = levelColor[l.level] || '';
    const time = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '';
    const source = l.source ? `[${l.source}]` : '';
    return `${color}${l.level.toUpperCase().padEnd(5)}${R} ${time} ${source} ${l.message}`;
  }).join('\n');
}
