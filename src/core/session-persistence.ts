/**
 * Session persistence — session save/load utilities.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface PersistedSession {
  id: string;
  title?: string;
  model: string;
  provider: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: number;
  updatedAt: number;
}

const SESSIONS_DIR = join(homedir(), '.kairo', 'sessions');

/**
 * Save a session to disk.
 */
export function saveSession(session: PersistedSession): void {
  try {
    if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
    session.updatedAt = Date.now();
    writeFileSync(join(SESSIONS_DIR, `${session.id}.json`), JSON.stringify(session, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Load a session from disk.
 */
export function loadSession(id: string): PersistedSession | null {
  try {
    const path = join(SESSIONS_DIR, `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * List all saved sessions.
 */
export function listSessions(limit = 20): PersistedSession[] {
  try {
    if (!existsSync(SESSIONS_DIR)) return [];
    const files = readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map(f => {
      try {
        return JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf-8'));
      } catch {
        return null;
      }
    }).filter(Boolean) as PersistedSession[];
  } catch {
    return [];
  }
}

/**
 * Delete a session from disk.
 */
export function deleteSession(id: string): boolean {
  try {
    const { unlinkSync } = require('fs');
    const path = join(SESSIONS_DIR, `${id}.json`);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new session.
 */
export function createSession(model: string, provider: string): PersistedSession {
  return {
    id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    model,
    provider,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Format sessions for display.
 */
export function formatSessions(sessions: PersistedSession[]): string {
  if (sessions.length === 0) return 'No saved sessions.';

  return sessions.map(s => {
    const title = s.title || s.id;
    const time = new Date(s.updatedAt).toLocaleString();
    const msgs = s.messages.length;
    return `• ${title} (${s.model}) — ${msgs} msgs, ${time}`;
  }).join('\n');
}
