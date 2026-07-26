/**
 * Startup restart recovery.
 *
 * Handles recovery of interrupted operations (file uploads, etc.)
 * after a restart.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface RecoveryState {
  /** Files that were being uploaded when shutdown occurred */
  pendingUploads: PendingUpload[];
  /** Checkpoints for in-progress operations */
  checkpoints: Map<string, RecoveryCheckpoint>;
  /** Last successful recovery timestamp */
  lastRecovery: number;
}

export interface PendingUpload {
  filePath: string;
  sessionId: string;
  startedAt: number;
  progress: number; // 0-100
  tempPath?: string;
}

export interface RecoveryCheckpoint {
  id: string;
  operation: string;
  data: Record<string, unknown>;
  createdAt: number;
}

/**
 * Create a new recovery state.
 */
export function createRecoveryState(): RecoveryState {
  return {
    pendingUploads: [],
    checkpoints: new Map(),
    lastRecovery: Date.now(),
  };
}

/**
 * Load recovery state from disk.
 */
export async function loadRecoveryState(statePath: string): Promise<RecoveryState> {
  try {
    const data = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      checkpoints: new Map(Object.entries(parsed.checkpoints || {})),
    };
  } catch {
    return createRecoveryState();
  }
}

/**
 * Save recovery state to disk.
 */
export async function saveRecoveryState(
  state: RecoveryState,
  statePath: string
): Promise<void> {
  const dir = path.dirname(statePath);
  await fs.mkdir(dir, { recursive: true });

  const serialized = {
    ...state,
    checkpoints: Object.fromEntries(state.checkpoints),
  };

  await fs.writeFile(statePath, JSON.stringify(serialized, null, 2));
}

/**
 * Add a pending upload to recovery state.
 */
export function addPendingUpload(
  state: RecoveryState,
  upload: PendingUpload
): void {
  // Remove existing entry for same file
  state.pendingUploads = state.pendingUploads.filter(
    u => u.filePath !== upload.filePath
  );
  state.pendingUploads.push(upload);
}

/**
 * Remove a pending upload from recovery state.
 */
export function removePendingUpload(
  state: RecoveryState,
  filePath: string
): void {
  state.pendingUploads = state.pendingUploads.filter(
    u => u.filePath !== filePath
  );
}

/**
 * Set a recovery checkpoint.
 */
export function setCheckpoint(
  state: RecoveryState,
  id: string,
  operation: string,
  data: Record<string, unknown> = {}
): void {
  state.checkpoints.set(id, {
    id,
    operation,
    data,
    createdAt: Date.now(),
  });
}

/**
 * Get a recovery checkpoint.
 */
export function getCheckpoint(
  state: RecoveryState,
  id: string
): RecoveryCheckpoint | undefined {
  return state.checkpoints.get(id);
}

/**
 * Remove a recovery checkpoint.
 */
export function removeCheckpoint(state: RecoveryState, id: string): void {
  state.checkpoints.delete(id);
}

/**
 * Clean up stale recovery state (older than maxAgeMs).
 */
export function cleanupStaleState(
  state: RecoveryState,
  maxAgeMs: number = 24 * 60 * 60 * 1000 // 24 hours
): void {
  const cutoff = Date.now() - maxAgeMs;

  // Remove stale pending uploads
  state.pendingUploads = state.pendingUploads.filter(
    u => u.startedAt > cutoff
  );

  // Remove stale checkpoints
  for (const [id, checkpoint] of state.checkpoints) {
    if (checkpoint.createdAt < cutoff) {
      state.checkpoints.delete(id);
    }
  }

  state.lastRecovery = Date.now();
}

/**
 * Get files that need recovery.
 */
export function getFilesNeedingRecovery(state: RecoveryState): PendingUpload[] {
  return state.pendingUploads.filter(u => u.progress < 100);
}

/**
 * Check if recovery is needed.
 */
export function needsRecovery(state: RecoveryState): boolean {
  return state.pendingUploads.some(u => u.progress < 100) || state.checkpoints.size > 0;
}
