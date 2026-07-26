/**
 * Coding verification evidence ledger.
 *
 * Records what the agent actually proved while working in a code workspace.
 * Deliberately passive: never decides to run a suite, never blocks completion.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface VerificationEvidence {
  command: string;
  canonicalCommand: string;
  kind: string;       // 'test' | 'lint' | 'build' | 'typecheck' | 'verify'
  scope: string;      // 'file' | 'module' | 'project'
  status: string;     // 'pass' | 'fail' | 'error'
  exitCode: number;
  cwd: string;
  sessionId: string;
  outputSummary: string;
  timestamp: string;
}

// In-memory store (file-backed for persistence)
let evidenceStore: VerificationEvidence[] = [];
const MAX_EVIDENCE = 1000;
const STORE_FILE = join(homedir(), '.kairo', 'verification-evidence.json');

/**
 * Load evidence from disk.
 */
function loadEvidence(): void {
  try {
    if (existsSync(STORE_FILE)) {
      const data = JSON.parse(readFileSync(STORE_FILE, 'utf-8'));
      if (Array.isArray(data)) evidenceStore = data.slice(-MAX_EVIDENCE);
    }
  } catch { /* start fresh */ }
}

/**
 * Save evidence to disk.
 */
function saveEvidence(): void {
  try {
    const dir = join(homedir(), '.kairo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify(evidenceStore.slice(-MAX_EVIDENCE)), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Canonicalize a command for deduplication.
 * Strips variable parts (timestamps, random strings, etc.).
 */
export function canonicalizeCommand(command: string): string {
  // Remove common variable parts
  let canonical = command
    .replace(/\d{10,13}/g, '<timestamp>')  // timestamps
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')  // UUIDs
    .replace(/\/tmp\/[^\s]+/g, '<tmpfile>')  // temp files
    .trim();
  return canonical;
}

/**
 * Classify a command into a kind.
 */
export function classifyCommand(command: string): string {
  const lower = command.toLowerCase();
  if (lower.includes('test') || lower.includes('jest') || lower.includes('vitest') || lower.includes('mocha')) return 'test';
  if (lower.includes('lint') || lower.includes('eslint') || lower.includes('prettier')) return 'lint';
  if (lower.includes('build') || lower.includes('compile') || lower.includes('tsc')) return 'build';
  if (lower.includes('typecheck') || lower.includes('--noEmit')) return 'typecheck';
  if (lower.includes('verify') || lower.includes('check')) return 'verify';
  return 'exec';
}

/**
 * Record verification evidence.
 */
export function recordEvidence(opts: {
  command: string;
  exitCode: number;
  cwd: string;
  sessionId: string;
  output?: string;
  scope?: string;
}): void {
  if (evidenceStore.length === 0) loadEvidence();

  const kind = classifyCommand(opts.command);
  const status = opts.exitCode === 0 ? 'pass' : 'fail';
  const scope = opts.scope || 'project';
  const outputSummary = (opts.output || '').slice(0, 2000).trim();

  const evidence: VerificationEvidence = {
    command: opts.command,
    canonicalCommand: canonicalizeCommand(opts.command),
    kind,
    scope,
    status,
    exitCode: opts.exitCode,
    cwd: opts.cwd,
    sessionId: opts.sessionId,
    outputSummary,
    timestamp: new Date().toISOString(),
  };

  evidenceStore.push(evidence);
  if (evidenceStore.length > MAX_EVIDENCE) {
    evidenceStore = evidenceStore.slice(-MAX_EVIDENCE);
  }
  saveEvidence();
}

/**
 * Get recent evidence for a session.
 */
export function getSessionEvidence(sessionId: string, limit = 20): VerificationEvidence[] {
  if (evidenceStore.length === 0) loadEvidence();
  return evidenceStore
    .filter(e => e.sessionId === sessionId)
    .slice(-limit);
}

/**
 * Get the last N evidence entries.
 */
export function getRecentEvidence(limit = 10): VerificationEvidence[] {
  if (evidenceStore.length === 0) loadEvidence();
  return evidenceStore.slice(-limit);
}

/**
 * Check if a specific command was already verified successfully in this session.
 */
export function wasAlreadyVerified(command: string, sessionId: string): boolean {
  if (evidenceStore.length === 0) loadEvidence();
  const canonical = canonicalizeCommand(command);
  return evidenceStore.some(e =>
    e.sessionId === sessionId &&
    e.canonicalCommand === canonical &&
    e.status === 'pass'
  );
}

/**
 * Get the pass rate across all evidence (0-1).
 */
export function getPassRate(): number {
  if (evidenceStore.length === 0) loadEvidence();
  if (evidenceStore.length === 0) return 1;
  const passed = evidenceStore.filter(e => e.status === 'pass').length;
  return passed / evidenceStore.length;
}

/**
 * Get evidence summary as a formatted string.
 */
export function getEvidenceSummary(): string {
  if (evidenceStore.length === 0) loadEvidence();
  if (evidenceStore.length === 0) return 'No verification evidence recorded.';
  const passed = evidenceStore.filter(e => e.status === 'pass').length;
  const failed = evidenceStore.filter(e => e.status === 'fail').length;
  const kinds = new Map<string, { p: number; f: number }>();
  for (const e of evidenceStore) {
    const k = kinds.get(e.kind) || { p: 0, f: 0 };
    if (e.status === 'pass') k.p++; else k.f++;
    kinds.set(e.kind, k);
  }
  const parts = [...kinds.entries()].map(([kind, { p, f }]) => `${kind}: ${p}✓ ${f}✗`);
  return `${passed} passed, ${failed} failed (${parts.join(', ')})`;
}

/**
 * Get verification summary for a session.
 */
export function getVerificationSummary(sessionId: string): {
  total: number;
  passed: number;
  failed: number;
  kinds: Record<string, { passed: number; failed: number }>;
} {
  if (evidenceStore.length === 0) loadEvidence();
  const sessionEvidence = evidenceStore.filter(e => e.sessionId === sessionId);
  const kinds: Record<string, { passed: number; failed: number }> = {};

  let passed = 0, failed = 0;
  for (const e of sessionEvidence) {
    if (!kinds[e.kind]) kinds[e.kind] = { passed: 0, failed: 0 };
    if (e.status === 'pass') {
      passed++;
      kinds[e.kind].passed++;
    } else {
      failed++;
      kinds[e.kind].failed++;
    }
  }

  return { total: sessionEvidence.length, passed, failed, kinds };
}

/**
 * Clear evidence for a session.
 */
export function clearSessionEvidence(sessionId: string): void {
  evidenceStore = evidenceStore.filter(e => e.sessionId !== sessionId);
  saveEvidence();
}
