/**
 * File state — track file modification state for conflict detection.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';

export interface FileState {
  path: string;
  hash: string;
  size: number;
  mtime: number;
  checkedAt: number;
}

// Cache of file states
const fileStates = new Map<string, FileState>();

/**
 * Get the current state of a file.
 */
export function getFileState(path: string): FileState | null {
  try {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    const content = readFileSync(path);
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    return {
      path,
      hash,
      size: stat.size,
      mtime: stat.mtimeMs,
      checkedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Snapshot a file's state for later conflict detection.
 */
export function snapshotFile(path: string): FileState | null {
  const state = getFileState(path);
  if (state) fileStates.set(path, state);
  return state;
}

/**
 * Check if a file has changed since the last snapshot.
 */
export function hasFileChanged(path: string): boolean {
  const cached = fileStates.get(path);
  if (!cached) return true; // No snapshot = assume changed
  const current = getFileState(path);
  if (!current) return true; // File deleted
  return current.hash !== cached.hash;
}

/**
 * Get the hash of a file's content.
 */
export function hashFile(path: string): string | null {
  try {
    const content = readFileSync(path);
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Check if a write would conflict with external changes.
 */
export function wouldConflict(path: string): { conflict: boolean; reason?: string } {
  const cached = fileStates.get(path);
  if (!cached) return { conflict: false }; // No snapshot = no conflict

  const current = getFileState(path);
  if (!current) return { conflict: false }; // File doesn't exist

  if (current.hash !== cached.hash) {
    return {
      conflict: true,
      reason: `File ${path} was modified externally (hash mismatch: ${cached.hash} → ${current.hash})`,
    };
  }

  return { conflict: false };
}

/**
 * Clear all file state snapshots.
 */
export function clearFileStates(): void {
  fileStates.clear();
}
