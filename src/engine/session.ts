/**
 * Session management — workspace session types and checkpoint tracking.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CapabilityMode } from './capability.js';

// Re-export from capability module for backwards compatibility
export type { CapabilityMode } from './capability.js';

// ─── Session Identity ──────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  cwd: string;
  createdAt: number;
  depth: number;
  forkBudget: number;
}

// ─── Checkpoint ────────────────────────────────────────────

export interface HunkCheckpoint {
  turnIndex: number;
  hunks: HunkDelta[];
  gitRef?: string;
  timestamp: number;
}

export interface HunkDelta {
  filePath: string;
  added: string[];
  removed: string[];
  startLine: number;
}

export interface GitCheckpoint {
  ref: string;
  staged: boolean;
  timestamp: number;
}

// ─── File State ────────────────────────────────────────────

export interface FileState {
  path: string;
  exists: boolean;
  contentHash?: string;
  lastModified: number;
}

// ─── Checkpoint Store ──────────────────────────────────────

export class CheckpointStore {
  private dir: string;
  private sessionId: string;
  private checkpoints: Map<number, HunkCheckpoint> = new Map();

  constructor(cwd: string, sessionId: string) {
    this.dir = path.join(cwd, '.kairo', 'checkpoints', sessionId);
    this.sessionId = sessionId;
  }

  async save(turnIndex: number, checkpoint: HunkCheckpoint): Promise<void> {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    const filePath = path.join(this.dir, `turn-${turnIndex}.json`);
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    this.checkpoints.set(turnIndex, checkpoint);
  }

  async load(turnIndex: number): Promise<HunkCheckpoint | null> {
    if (this.checkpoints.has(turnIndex)) {
      return this.checkpoints.get(turnIndex)!;
    }
    const filePath = path.join(this.dir, `turn-${turnIndex}.json`);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const checkpoint = JSON.parse(content) as HunkCheckpoint;
      this.checkpoints.set(turnIndex, checkpoint);
      return checkpoint;
    } catch {
      return null;
    }
  }

  async list(): Promise<number[]> {
    try {
      return fs.readdirSync(this.dir)
        .filter(f => f.startsWith('turn-') && f.endsWith('.json'))
        .map(f => parseInt(f.replace('turn-', '').replace('.json', '')))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    this.checkpoints.clear();
    if (fs.existsSync(this.dir)) {
      fs.rmSync(this.dir, { recursive: true, force: true });
    }
  }
}

// ─── Git Checkpoint Store ──────────────────────────────────

export class GitCheckpointStore {
  private checkpoints: Map<number, GitCheckpoint> = new Map();

  save(turnIndex: number, ref: string, staged: boolean): void {
    this.checkpoints.set(turnIndex, {
      ref,
      staged,
      timestamp: Date.now(),
    });
  }

  get(turnIndex: number): GitCheckpoint | undefined {
    return this.checkpoints.get(turnIndex);
  }

  list(): number[] {
    return Array.from(this.checkpoints.keys()).sort((a, b) => a - b);
  }

  clear(): void {
    this.checkpoints.clear();
  }
}

// ─── File State Tracker ────────────────────────────────────

export class FileStateTracker {
  private states: Map<string, FileState> = new Map();

  track(filePath: string): void {
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    this.states.set(filePath, {
      path: filePath,
      exists: !!stat,
      lastModified: stat?.mtimeMs ?? Date.now(),
    });
  }

  getState(filePath: string): FileState | undefined {
    return this.states.get(filePath);
  }

  hasChanged(filePath: string): boolean {
    const state = this.states.get(filePath);
    if (!state) return true;
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    return (!stat) !== state.exists || (stat?.mtimeMs ?? 0) !== state.lastModified;
  }

  snapshot(): Map<string, FileState> {
    return new Map(this.states);
  }

  clear(): void {
    this.states.clear();
  }
}

// ─── Workspace Session ─────────────────────────────────────

export interface WorkspaceSessionConfig {
  sessionId: string;
  cwd: string;
  capabilityMode: CapabilityMode;
  depth: number;
  forkBudget: number;
  viewerContext?: Record<string, unknown>;
}

export function createWorkspaceSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Result Types ──────────────────────────────────────────

export interface ExtMethodError {
  code: number;
  message: string;
  data?: unknown;
}

export interface ExtMethodResult<T> {
  result?: T;
  error?: unknown;
}
