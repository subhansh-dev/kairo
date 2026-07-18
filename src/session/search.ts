/**
 * Kairo — Session Search (FTS5-inspired, JSON-backed)
 * Three modes: DISCOVERY (query), SCROLL (anchor), BROWSE (list)
 * Zero LLM calls — direct from JSON session store
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ChatMessage } from '../providers/registry.js';

const SESSIONS_DIR = join(homedir(), '.kairo', 'sessions');

interface SessionMessage {
  role: string;
  content: string;
  timestamp?: string;
  tool_name?: string;
}

interface RawSession {
  id: string;
  title: string;
  messages: SessionMessage[];
  model: string;
  provider: string;
  createdAt?: string;
  updatedAt?: string;
  summary?: string;
  parent_session_id?: string;
}

interface SearchHit {
  sessionId: string;
  title: string;
  matchedText: string;
  matchIndex: number;
  messageCount: number;
  updatedAt: string;
}

interface ScrollWindow {
  before: SessionMessage[];
  anchor: SessionMessage;
  after: SessionMessage[];
  sessionTitle: string;
  sessionId: string;
}

interface BrowseEntry {
  id: string;
  title: string;
  messageCount: number;
  model: string;
  updatedAt: string;
  preview: string;
}

export interface SearchResult {
  query?: string;
  mode: 'discovery' | 'scroll' | 'browse';
  hits?: SearchHit[];
  window?: ScrollWindow;
  sessions?: BrowseEntry[];
  error?: string;
}

function getAllSessions(): RawSession[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  try {
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const sessions: RawSession[] = [];
    for (const f of files) {
      try {
        sessions.push(JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf-8')));
      } catch {}
    }
    return sessions;
  } catch {
    return [];
  }
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const HIDDEN_SOURCES = new Set(['subagent', 'tool']);

function shouldExclude(session: RawSession): boolean {
  const source = (session as any).source || '';
  return HIDDEN_SOURCES.has(source);
}

export function searchSessions(query: string, maxResults: number = 5): SearchResult {
  const sessions = getAllSessions().filter(s => !shouldExclude(s));
  const lowerQuery = query.toLowerCase();
  const results: SearchHit[] = [];

  for (const session of sessions) {
    let contentText = '';
    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      if (msg.role === 'system') continue;
      const c = msg.content || '';
      contentText += '\n' + c;
    }

    const lower = contentText.toLowerCase();
    const idx = lower.indexOf(lowerQuery);
    if (idx >= 0) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(contentText.length, idx + query.length + 60);
      let matched = contentText.slice(start, end).trim();
      if (start > 0) matched = '...' + matched;
      if (end < contentText.length) matched = matched + '...';

      results.push({
        sessionId: session.id,
        title: session.title || 'Untitled',
        matchedText: matched,
        matchIndex: idx,
        messageCount: session.messages.length,
        updatedAt: session.updatedAt || session.createdAt || '',
      });
    }
  }

  results.sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime() || 0;
    const bTime = new Date(b.updatedAt).getTime() || 0;
    return bTime - aTime;
  });

  return {
    query,
    mode: 'discovery',
    hits: results.slice(0, maxResults),
  };
}

export function getScrollWindow(sessionId: string, anchorIndex: number, windowSize: number = 5): SearchResult {
  const sessions = getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return { mode: 'scroll', error: `Session not found: ${sessionId}` };

  const msgs = session.messages.filter(m => m.role !== 'system');
  if (anchorIndex < 0 || anchorIndex >= msgs.length) {
    return { mode: 'scroll', error: `Message index ${anchorIndex} out of range (0-${msgs.length - 1})` };
  }

  const before = msgs.slice(Math.max(0, anchorIndex - windowSize), anchorIndex);
  const anchor = msgs[anchorIndex];
  const after = msgs.slice(anchorIndex + 1, anchorIndex + 1 + windowSize);

  return {
    mode: 'scroll',
    window: {
      before,
      anchor,
      after,
      sessionTitle: session.title || session.id,
      sessionId: session.id,
    },
  };
}

export function browseSessions(maxResults: number = 10): SearchResult {
  const sessions = getAllSessions()
    .filter(s => !shouldExclude(s))
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
      return bTime - aTime;
    })
    .slice(0, maxResults);

  return {
    mode: 'browse',
    sessions: sessions.map(s => {
      const firstUser = s.messages.find(m => m.role === 'user');
      const preview = firstUser
        ? (firstUser.content || '').slice(0, 80)
        : '(empty)';
      const updated = s.updatedAt || s.createdAt || '';
      return {
        id: s.id,
        title: s.title || 'Untitled',
        messageCount: s.messages.length,
        model: s.model || 'unknown',
        updatedAt: updated,
        preview,
      };
    }),
  };
}

export function formatSearchResult(result: SearchResult): string {
  const R = '\x1b[0m', D = '\x1b[2m', B = '\x1b[1m';
  const c = { primary: '\x1b[38;2;0;204;204m', muted: '\x1b[38;2;153;153;153m', accent: '\x1b[38;2;215;119;87m' };

  if (result.error) return `${c.primary}Error:${R} ${result.error}`;

  switch (result.mode) {
    case 'discovery': {
      if (!result.hits || result.hits.length === 0) {
        return `${D}No results for "${result.query}"${R}`;
      }
      const lines = result.hits.map((h, i) => {
        const time = h.updatedAt ? formatTimeAgo(new Date(h.updatedAt)) : 'unknown';
        return `${i + 1}. ${B}${c.primary}${h.title}${R} ${D}(${h.messageCount} msgs, ${time})${R}\n   ${D}${h.matchedText}${R}`;
      });
      return lines.join('\n\n') + `\n\n${D}${result.hits.length} result(s) for "${result.query}"${R}`;
    }

    case 'scroll': {
      if (!result.window) return `${D}No window data${R}`;
      const w = result.window;
      const lines: string[] = [
        `${c.primary}${B}Session: ${w.sessionTitle}${R}`,
      ];
      for (const msg of w.before) {
        lines.push(`  ${D}${msg.role}: ${(msg.content || '').slice(0, 100)}${R}`);
      }
      lines.push(`  ${c.accent}${B}→ ${w.anchor.role}: ${(w.anchor.content || '').slice(0, 100)}${R}`);
      for (const msg of w.after) {
        lines.push(`  ${D}${msg.role}: ${(msg.content || '').slice(0, 100)}${R}`);
      }
      return lines.join('\n');
    }

    case 'browse': {
      if (!result.sessions || result.sessions.length === 0) {
        return `${D}No sessions${R}`;
      }
      return result.sessions.map((s, i) => {
        const time = s.updatedAt ? formatTimeAgo(new Date(s.updatedAt)) : 'unknown';
        return `${i + 1}. ${B}${c.primary}${s.title}${R} ${D}(${s.messageCount} msgs, ${s.model}, ${time})${R}\n   ${D}${s.preview}${R}`;
      }).join('\n\n');
    }
  }
}
