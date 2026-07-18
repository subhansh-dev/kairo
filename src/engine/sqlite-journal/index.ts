/**
 * SQLite journal — session persistence using JSON file storage.
 * (Simplified: uses JSON files instead of actual SQLite for portability.)
 */

import * as fs from 'fs';
import * as path from 'path';

export interface JournalEntry {
  id: string;
  sessionId: string;
  timestamp: Date;
  type: 'message' | 'tool_call' | 'tool_result' | 'summary' | 'checkpoint';
  data: Record<string, unknown>;
}

export interface JournalConfig {
  journalDir: string;
  maxEntriesPerSession: number;
}

/**
 * Create a journal config.
 */
export function createJournalConfig(journalDir: string): JournalConfig {
  return {
    journalDir,
    maxEntriesPerSession: 10000,
  };
}

/**
 * Write a journal entry.
 */
export function writeJournalEntry(
  config: JournalConfig,
  entry: JournalEntry,
): void {
  const sessionFile = path.join(config.journalDir, `${entry.sessionId}.jsonl`);

  if (!fs.existsSync(config.journalDir)) {
    fs.mkdirSync(config.journalDir, { recursive: true });
  }

  const line = JSON.stringify({
    ...entry,
    timestamp: entry.timestamp.toISOString(),
  }) + '\n';

  fs.appendFileSync(sessionFile, line, 'utf-8');
}

/**
 * Read all journal entries for a session.
 */
export function readJournalEntries(
  config: JournalConfig,
  sessionId: string,
): JournalEntry[] {
  const sessionFile = path.join(config.journalDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(sessionFile)) return [];

  const content = fs.readFileSync(sessionFile, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  return lines.map(line => {
    try {
      const parsed = JSON.parse(line);
      return { ...parsed, timestamp: new Date(parsed.timestamp) };
    } catch {
      return null;
    }
  }).filter(Boolean) as JournalEntry[];
}

/**
 * Get journal entry count for a session.
 */
export function journalEntryCount(config: JournalConfig, sessionId: string): number {
  const sessionFile = path.join(config.journalDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(sessionFile)) return 0;

  const content = fs.readFileSync(sessionFile, 'utf-8');
  return content.split('\n').filter(Boolean).length;
}

/**
 * List all session IDs in the journal.
 */
export function listJournalSessions(config: JournalConfig): string[] {
  if (!fs.existsSync(config.journalDir)) return [];

  return fs.readdirSync(config.journalDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace('.jsonl', ''));
}

/**
 * Delete a journal session.
 */
export function deleteJournalSession(config: JournalConfig, sessionId: string): void {
  const sessionFile = path.join(config.journalDir, `${sessionId}.jsonl`);
  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile);
  }
}
