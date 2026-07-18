/**
 * @deprecated This module is unused — the engine uses session/manager.ts instead.
 * This file has an incompatible schema (ISO string dates vs epoch numbers)
 * and will cause data corruption if mixed with manager.ts sessions.
 * Kept for reference only. Do not import.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { ChatMessage } from '../providers/registry.js';

// ─── Types ──────────────────────────────────────────────────────

export interface PersistedSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
  tokenCount: number;
  summary?: string;
  tags?: string[];
}

// ─── Session Store ──────────────────────────────────────────────

const SESSIONS_DIR = join(homedir(), '.kairo', 'sessions');

function ensureDir() {
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionPath(id: string): string {
  return join(SESSIONS_DIR, `${id}.json`);
}

// ─── Save Session ───────────────────────────────────────────────

export function saveSession(session: PersistedSession): void {
  ensureDir();
  session.updatedAt = new Date().toISOString();
  writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2));
}

// ─── Load Session ───────────────────────────────────────────────

export function loadSession(id: string): PersistedSession | null {
  const path = sessionPath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── List Sessions ──────────────────────────────────────────────

export function listSessions(limit: number = 20): PersistedSession[] {
  ensureDir();
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  const sessions: PersistedSession[] = [];

  for (const f of files) {
    try {
      const session = JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf-8'));
      sessions.push(session);
    } catch {}
  }

  return sessions
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}

// ─── Delete Session ─────────────────────────────────────────────

export function deleteSession(id: string): boolean {
  const path = sessionPath(id);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Create New Session ─────────────────────────────────────────

export function createSession(model: string, provider: string): PersistedSession {
  const now = new Date().toISOString();
  return {
    id: randomUUID().slice(0, 8),
    title: 'New Session',
    messages: [],
    model,
    provider,
    createdAt: now,
    updatedAt: now,
    tokenCount: 0,
  };
}

// ─── Auto-title from first message ──────────────────────────────

export function autoTitle(session: PersistedSession): string {
  const firstUser = session.messages.find(m => m.role === 'user');
  if (!firstUser) return 'Empty Session';
  const content = typeof firstUser.content === 'string' ? firstUser.content : '';
  return content.slice(0, 60) + (content.length > 60 ? '...' : '');
}

// ─── Format Session List ────────────────────────────────────────

export function formatSessionList(sessions: PersistedSession[]): string {
  if (sessions.length === 0) return 'No saved sessions.';

  return sessions.map((s, i) => {
    const date = new Date(s.updatedAt);
    const timeAgo = formatTimeAgo(date);
    const msgs = s.messages.length;
    const model = s.model.split('/').pop() || s.model;
    return `  ${i + 1}. ${s.title || s.id} ${D}(${msgs} msgs, ${model}, ${timeAgo})${R}`;
  }).join('\n');
}

const D = '\x1b[2m';
const R = '\x1b[0m';

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
