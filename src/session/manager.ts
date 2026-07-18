/**
 * Kairo — Session Management
 * Persistent sessions with context compaction
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { ChatMessage } from '../providers/registry.js';

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  /** Archive of messages before compaction (never compacted away) */
  archivedMessages?: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  model: string;
  provider: string;
  tokenCount: number;
}

export class SessionManager {
  private sessionsDir: string;
  private currentSession: Session | null = null;

  constructor() {
    this.sessionsDir = join(homedir(), '.kairo', 'sessions');
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  createSession(model: string, provider: string): Session {
    const session: Session = {
      id: randomUUID().slice(0, 8),
      title: 'New Session',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model,
      provider,
      tokenCount: 0,
    };
    this.currentSession = session;
    this.saveSession(session);
    return session;
  }

  loadSession(id: string): Session | null {
    const path = join(this.sessionsDir, `${id}.json`);
    if (!existsSync(path)) return null;
    try {
      const session = JSON.parse(readFileSync(path, 'utf-8'));
      this.currentSession = session;
      return session;
    } catch {
      return null;
    }
  }

  saveSession(session: Session): void {
    session.updatedAt = Date.now();
    const path = join(this.sessionsDir, `${session.id}.json`);
    // Atomic write: write to .tmp first, then rename (prevents corrupted JSON on crash)
    const tmpPath = path + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(session, null, 2));
    renameSync(tmpPath, path);
  }

  listSessions(): Session[] {
    const files = readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        return JSON.parse(readFileSync(join(this.sessionsDir, f), 'utf-8'));
      } catch {
        return null;
      }
    }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  addMessage(message: ChatMessage): void {
    if (!this.currentSession) return;
    this.currentSession.messages.push(message);
    this.currentSession.tokenCount += this.estimateTokens(typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
    this.saveSession(this.currentSession);
  }

  // Context compaction — summarize old messages to save tokens
  compact(maxTokens: number = 4000): ChatMessage[] {
    if (!this.currentSession) return [];

    const messages = this.currentSession.messages;
    if (this.currentSession.tokenCount <= maxTokens) return messages;

    // Keep system prompt and last N messages
    const keepLast = 6;
    const systemMsg = messages.find(m => m.role === 'system');
    const recentMsgs = messages.slice(-keepLast);
    const oldMsgs = messages.slice(1, -keepLast); // Exclude system and recent

    // Archive original messages before compacting (irreversible operation)
    if (!this.currentSession.archivedMessages) {
      this.currentSession.archivedMessages = [];
    }
    this.currentSession.archivedMessages.push(...oldMsgs);

    // Summarize old messages
    const summary = oldMsgs.map(m => {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${m.role}: ${text.slice(0, 100)}`;
    }).join('\n');
    const summaryMsg: ChatMessage = { 
      role: 'system', 
      content: `[Context compacted. Previous conversation summary:]\n${summary}` 
    };

    const compacted = systemMsg 
      ? [systemMsg, summaryMsg, ...recentMsgs]
      : [summaryMsg, ...recentMsgs];

    this.currentSession.messages = compacted;
    this.currentSession.tokenCount = compacted.reduce((sum, m) => sum + this.estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0);
    this.saveSession(this.currentSession);

    return compacted;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  // ─── Session Search ─────────────────────────

  /**
   * Search sessions by query string (matches title, messages, or tags)
   */
  searchSessions(query: string): Session[] {
    const lowerQuery = query.toLowerCase();
    return this.listSessions().filter(s => {
      if (s.title.toLowerCase().includes(lowerQuery)) return true;
      return s.messages.some(m => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return content.toLowerCase().includes(lowerQuery);
      });
    });
  }

  /**
   * Get session statistics
   */
  getSessionStats(): { totalSessions: number; totalMessages: number; totalTokens: number } {
    const sessions = this.listSessions();
    return {
      totalSessions: sessions.length,
      totalMessages: sessions.reduce((sum, s) => sum + s.messages.length, 0),
      totalTokens: sessions.reduce((sum, s) => sum + s.tokenCount, 0),
    };
  }

  /**
   * Extract session memories for long-term storage
   */
  extractSessionMemories(): string[] {
    if (!this.currentSession) return [];
    const memories: string[] = [];

    for (const msg of this.currentSession.messages) {
      if (msg.role !== 'assistant') continue;
      const content = typeof msg.content === 'string' ? msg.content : '';

      // Extract decisions
      const decisionPattern = /(?:decided|chose|picked|going with|using)\s+(.{20,100})/gi;
      let match;
      while ((match = decisionPattern.exec(content))) {
        memories.push(`Decision: ${match[1].trim()}`);
      }

      // Extract file paths
      const pathPattern = /(?:created|modified|wrote|edited|fixed)\s+(?:file\s+)?[`"']?([\/\w.-]+\.\w+)[`"']?/gi;
      while ((match = pathPattern.exec(content))) {
        memories.push(`File: ${match[1]}`);
      }
    }

    return [...new Set(memories)].slice(0, 20);
  }

  /**
   * Auto-title the session from first user message
   */
  autoTitle(): void {
    if (!this.currentSession) return;
    const firstUser = this.currentSession.messages.find(m => m.role === 'user');
    if (!firstUser) return;
    const content = typeof firstUser.content === 'string' ? firstUser.content : '';
    this.currentSession.title = content.slice(0, 60) + (content.length > 60 ? '...' : '');
    this.saveSession(this.currentSession);
  }
}
