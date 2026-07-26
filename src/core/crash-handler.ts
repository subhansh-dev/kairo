/**
 * Kairo — Crash Handler
 * Catch and log crashes for debugging.
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CRASH_DIR = join(homedir(), '.kairo', 'crash-reports');

// ─── Types ──────────────────────────────────────────────────────

export interface CrashReport {
  id: string;
  timestamp: number;
  error: string;
  stack?: string;
  context: Record<string, any>;
  sessionId?: string;
}

// ─── Handler ────────────────────────────────────────────────────

let installed = false;

export function installCrashHandler(sessionId?: string): void {
  if (installed) return;
  installed = true;

  process.on('uncaughtException', (error: Error) => {
    reportCrash(error, { type: 'uncaughtException', sessionId });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    reportCrash(error, { type: 'unhandledRejection', sessionId });
  });
}

export function reportCrash(error: Error, context: Record<string, any> = {}): CrashReport {
  const report: CrashReport = {
    id: generateId(),
    timestamp: Date.now(),
    error: error.message,
    stack: error.stack,
    context,
    sessionId: context.sessionId,
  };

  // Save to disk
  if (!existsSync(CRASH_DIR)) mkdirSync(CRASH_DIR, { recursive: true });
  const path = join(CRASH_DIR, `${report.id}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8');

  return report;
}

export function getCrashReports(limit: number = 10): CrashReport[] {
  if (!existsSync(CRASH_DIR)) return [];

  try {
    const files = readdirSync(CRASH_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map(f => JSON.parse(readFileSync(join(CRASH_DIR, f), 'utf-8')));
  } catch {
    return [];
  }
}

export function clearCrashReports(): number {
  if (!existsSync(CRASH_DIR)) return 0;
  const files = readdirSync(CRASH_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      require('fs').unlinkSync(join(CRASH_DIR, f));
    } catch {}
  }
  return files.length;
}

function generateId(): string {
  return `crash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
