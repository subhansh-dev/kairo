/**
 * Disk-backed checkpoint store.
 *
 * Mirrors finalized checkpoints to disk for durability across
 * sandbox restores. In-memory cache is the hot read path.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { RewindCheckpoint } from './checkpoint';

const STORE_SUBDIR = 'rewind-checkpoints';
const DEFAULT_CHECKPOINT_CAP = 64;

function sessionStoreDirName(sessionId: string): string {
  // Sanitize session ID to prevent path traversal
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function checkpointFilePath(dir: string, promptIndex: number): string {
  return path.join(dir, `checkpoint-${promptIndex}.json`);
}

/**
 * Disk-backed, co-located checkpoint store with in-memory cache.
 */
export class DiskCheckpointStore {
  private dir: string;
  private cap: number;
  private cache: Map<number, RewindCheckpoint> = new Map();
  private ioLock: Promise<void> = Promise.resolve();

  constructor(cwd: string, sessionId: string, cap: number = DEFAULT_CHECKPOINT_CAP) {
    this.dir = path.join(cwd, '.kairo', STORE_SUBDIR, sessionStoreDirName(sessionId));
    this.cap = Math.max(1, cap);
  }

  /**
   * Initialize the store, rehydrating from disk if durable mode is on.
   */
  async init(): Promise<void> {
    if (!process.env['KAIRO_REWIND_DURABLE']) return;

    try {
      const files = await fs.readdir(this.dir);
      for (const file of files) {
        if (!file.startsWith('checkpoint-') || !file.endsWith('.json')) continue;
        const match = file.match(/checkpoint-(\d+)\.json/);
        if (!match) continue;
        const promptIndex = parseInt(match[1], 10);
        const content = await fs.readFile(path.join(this.dir, file), 'utf-8');
        const checkpoint = JSON.parse(content) as RewindCheckpoint;
        this.cache.set(promptIndex, checkpoint);
      }
      this.evict();
    } catch {
      // Directory doesn't exist yet
    }
  }

  /**
   * Persist a checkpoint to disk and cache.
   */
  async persist(checkpoint: RewindCheckpoint): Promise<void> {
    this.cache.set(checkpoint.promptIndex, checkpoint);

    if (!process.env['KAIRO_REWIND_DURABLE']) return;

    await fs.mkdir(this.dir, { recursive: true });
    const filePath = checkpointFilePath(this.dir, checkpoint.promptIndex);
    await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2));

    // Write .gitignore to prevent committing checkpoints
    const gitignorePath = path.join(this.dir, '.gitignore');
    try {
      await fs.access(gitignorePath);
    } catch {
      await fs.writeFile(gitignorePath, '*\n');
    }

    this.evict();
  }

  /**
   * Get a checkpoint from cache.
   */
  get(promptIndex: number): RewindCheckpoint | undefined {
    return this.cache.get(promptIndex);
  }

  /**
   * Get all checkpoints.
   */
  getAll(): RewindCheckpoint[] {
    return Array.from(this.cache.values()).sort(
      (a, b) => a.promptIndex - b.promptIndex
    );
  }

  /**
   * Truncate checkpoints from a prompt index onwards.
   */
  async truncateFrom(promptIndex: number): Promise<number> {
    const removed: number[] = [];

    for (const [index] of this.cache) {
      if (index >= promptIndex) {
        this.cache.delete(index);
        removed.push(index);
      }
    }

    if (process.env['KAIRO_REWIND_DURABLE']) {
      for (const index of removed) {
        try {
          await fs.unlink(checkpointFilePath(this.dir, index));
        } catch { /* */ }
      }
    }

    return removed.length;
  }

  /**
   * Evict oldest checkpoints beyond cap.
   */
  private evict(): void {
    while (this.cache.size > this.cap) {
      const oldest = Math.min(...this.cache.keys());
      this.cache.delete(oldest);
    }
  }

  /**
   * Get the number of stored checkpoints.
   */
  get size(): number {
    return this.cache.size;
  }
}
