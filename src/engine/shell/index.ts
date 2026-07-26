/**
 * Shell session — persistent shell session management.
 */

import { execCommand, type ShellCommand, type ShellResult } from '../shell-base/index.js';

export interface ShellSession {
  id: string;
  cwd: string;
  env: Record<string, string>;
  history: ShellHistoryEntry[];
  createdAt: Date;
  lastActive: Date;
}

export interface ShellHistoryEntry {
  command: string;
  result: ShellResult;
  timestamp: Date;
}

/**
 * Create a new shell session.
 */
export function createShellSession(cwd: string): ShellSession {
  return {
    id: crypto.randomUUID(),
    cwd,
    env: {},
    history: [],
    createdAt: new Date(),
    lastActive: new Date(),
  };
}

/**
 * Execute a command in a session.
 */
export async function execInSession(
  session: ShellSession,
  command: string,
  timeoutMs?: number,
): Promise<ShellResult> {
  const parts = parseCommand(command);

  const result = await execCommand({
    command: parts[0],
    args: parts.slice(1),
    cwd: session.cwd,
    env: session.env,
    timeoutMs,
  });

  session.history.push({
    command,
    result,
    timestamp: new Date(),
  });
  session.lastActive = new Date();

  // Update cwd if it was a cd command
  if (parts[0] === 'cd' && parts[1]) {
    const newCwd = resolveCwd(session.cwd, parts[1]);
    if (newCwd) session.cwd = newCwd;
  }

  return result;
}

/**
 * Get session history.
 */
export function getSessionHistory(session: ShellSession): ShellHistoryEntry[] {
  return [...session.history];
}

/**
 * Clear session history.
 */
export function clearSessionHistory(session: ShellSession): void {
  session.history.length = 0;
}

function parseCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of command) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function resolveCwd(current: string, target: string): string | null {
  if (target.startsWith('/') || target.match(/^[A-Z]:\\/i)) {
    return target;
  }
  if (target === '~') {
    return process.env.HOME || process.env.USERPROFILE || current;
  }
  if (target === '..') {
    return require('path').dirname(current);
  }
  return require('path').join(current, target);
}
