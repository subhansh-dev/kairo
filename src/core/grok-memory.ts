/**
 * Kairo — Grok Memory System
 * Cross-session knowledge persistence with embeddings and search.
 *
 * Markdown-based memory storage under ~/.kairo/memory/
 * Supports: global memory, workspace-scoped memory, session logs, search.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const MEMORY_DIR = join(homedir(), '.kairo', 'memory');

// ─── Types ──────────────────────────────────────────────────────

export type MemoryScope = 'global' | 'workspace' | 'session';

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  content: string;
  tags: string[];
  created: number;
  lastAccessed: number;
  accessCount: number;
  embedding?: number[];
  workspaceHash?: string;
}

export interface MemoryQuery {
  text: string;
  scope?: MemoryScope;
  tags?: string[];
  limit?: number;
  minScore?: number;
}

// ─── Storage ────────────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

function getWorkspaceHash(workspacePath: string): string {
  return createHash('blake2b').update(workspacePath).digest('hex').slice(0, 16);
}

function getWorkspaceDir(workspacePath?: string): string {
  if (!workspacePath) return MEMORY_DIR;
  const hash = getWorkspaceHash(workspacePath);
  const dir = join(MEMORY_DIR, hash);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Read/Write ─────────────────────────────────────────────────

export function writeMemory(entry: MemoryEntry): void {
  ensureDir();
  const dir = entry.scope === 'workspace' && entry.workspaceHash
    ? join(MEMORY_DIR, entry.workspaceHash)
    : MEMORY_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const path = join(dir, `${entry.id}.json`);
  writeFileSync(path, JSON.stringify(entry, null, 2), 'utf-8');
}

export function readMemory(id: string, scope: MemoryScope = 'global', workspaceHash?: string): MemoryEntry | null {
  const dir = scope === 'workspace' && workspaceHash
    ? join(MEMORY_DIR, workspaceHash)
    : MEMORY_DIR;
  const path = join(dir, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function listMemories(scope?: MemoryScope, workspaceHash?: string): MemoryEntry[] {
  ensureDir();
  const entries: MemoryEntry[] = [];
  const dirs = scope === 'workspace' && workspaceHash
    ? [join(MEMORY_DIR, workspaceHash)]
    : scope === 'global'
    ? [MEMORY_DIR]
    : [MEMORY_DIR, ...getWorkspaceDirs()];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const entry = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
        entries.push(entry);
      } catch {}
    }
  }

  return entries.sort((a, b) => b.lastAccessed - a.lastAccessed);
}

function getWorkspaceDirs(): string[] {
  if (!existsSync(MEMORY_DIR)) return [];
  return readdirSync(MEMORY_DIR)
    .filter(f => {
      const path = join(MEMORY_DIR, f);
      return statSync(path).isDirectory() && f !== 'sessions';
    })
    .map(f => join(MEMORY_DIR, f));
}

// ─── Search ─────────────────────────────────────────────────────

export function searchMemory(query: MemoryQuery): MemoryEntry[] {
  const entries = listMemories(query.scope);
  const queryLower = query.text.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  const scored = entries.map(entry => {
    const contentLower = entry.content.toLowerCase();
    let score = 0;

    // Exact match
    if (contentLower.includes(queryLower)) score += 1.0;

    // Word matches
    for (const word of queryWords) {
      if (contentLower.includes(word)) score += 0.3;
    }

    // Tag matches
    if (query.tags) {
      for (const tag of query.tags) {
        if (entry.tags.includes(tag)) score += 0.5;
      }
    }

    // Recency boost
    const ageMs = Date.now() - entry.lastAccessed;
    const recencyBoost = Math.max(0, 1 - ageMs / (30 * 24 * 60 * 60 * 1000)); // 30 days
    score += recencyBoost * 0.2;

    // Access count boost
    score += Math.min(entry.accessCount / 10, 0.3);

    return { entry, score };
  });

  return scored
    .filter(s => s.score >= (query.minScore || 0.1))
    .sort((a, b) => b.score - a.score)
    .slice(0, query.limit || 10)
    .map(s => {
      // Update access stats
      s.entry.lastAccessed = Date.now();
      s.entry.accessCount++;
      writeMemory(s.entry);
      return s.entry;
    });
}

// ─── Session Logs ───────────────────────────────────────────────

export function writeSessionLog(sessionId: string, content: string, workspacePath?: string): void {
  const dir = workspacePath ? getWorkspaceDir(workspacePath) : MEMORY_DIR;
  const sessionsDir = join(dir, 'sessions');
  if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const slug = sessionId.slice(0, 8);
  const path = join(sessionsDir, `${date}-${slug}.md`);
  writeFileSync(path, content, 'utf-8');
}

// ─── Global Memory (MEMORY.md) ──────────────────────────────────

export function appendToGlobalMemory(section: string, content: string): void {
  ensureDir();
  const path = join(MEMORY_DIR, 'MEMORY.md');
  let existing = '';
  if (existsSync(path)) existing = readFileSync(path, 'utf-8');

  const timestamp = new Date().toISOString().split('T')[0];
  const entry = `\n\n## ${section} (${timestamp})\n\n${content}`;

  writeFileSync(path, existing + entry, 'utf-8');
}

export function readGlobalMemory(): string {
  const path = join(MEMORY_DIR, 'MEMORY.md');
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}
