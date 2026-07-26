/**
 * Tool result storage — persist and retrieve tool results.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STORAGE_DIR = join(homedir(), '.kairo', 'tool-results');

interface StoredResult {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
  timestamp: number;
  durationMs: number;
}

/**
 * Store a tool result for later reference.
 */
export function storeResult(result: StoredResult): void {
  try {
    if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
    const filename = `${result.toolName}_${Date.now()}.json`;
    writeFileSync(join(STORAGE_DIR, filename), JSON.stringify(result, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Get recent tool results.
 */
export function getRecentResults(limit = 10): StoredResult[] {
  try {
    const { readdirSync } = require('fs');
    const files = readdirSync(STORAGE_DIR)
      .filter((f: string) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map((f: string) => {
      try {
        return JSON.parse(readFileSync(join(STORAGE_DIR, f), 'utf-8'));
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get results for a specific tool.
 */
export function getToolResults(toolName: string, limit = 5): StoredResult[] {
  return getRecentResults(50).filter(r => r.toolName === toolName).slice(0, limit);
}

/**
 * Clear old results (keep last N).
 */
export function cleanupResults(keepLast = 100): void {
  try {
    const { readdirSync, unlinkSync } = require('fs');
    const files = readdirSync(STORAGE_DIR)
      .filter((f: string) => f.endsWith('.json'))
      .sort();

    if (files.length > keepLast) {
      const toDelete = files.slice(0, files.length - keepLast);
      for (const f of toDelete) {
        try { unlinkSync(join(STORAGE_DIR, f)); } catch { /* ok */ }
      }
    }
  } catch { /* ok */ }
}
