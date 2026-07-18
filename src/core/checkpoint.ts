/**
 * Kairo — Checkpoint / Rollback System
 * Git-backed filesystem snapshots for state save/restore
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, renameSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const CHECKPOINT_DIR = join(homedir(), '.kairo', 'checkpoints');

interface CheckpointMeta {
  id: string;
  label: string;
  timestamp: number;
  files: number;
  size: number;
  projectDir: string;
  fileMap: Record<string, string>; // hash → original path
}

export interface FileSnapshot {
  path: string;
  content: string;
  hash: string;
  mtime: number;
}

// ─── Snapshot Store ───────────────────────────────────────

const snapshotStore = new Map<string, FileSnapshot>();

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function ensureCheckpointDir(): void {
  if (!existsSync(CHECKPOINT_DIR)) mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

// ─── File Snapshots ───────────────────────────────────────

export function recordSnapshot(filePath: string): FileSnapshot | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf-8');
    const stats = statSync(filePath);
    const snapshot: FileSnapshot = {
      path: filePath,
      content,
      hash: contentHash(content),
      mtime: stats.mtimeMs,
    };
    snapshotStore.set(filePath, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

export function getSnapshot(filePath: string): FileSnapshot | undefined {
  return snapshotStore.get(filePath);
}

export function hasChanged(filePath: string): boolean {
  const snapshot = snapshotStore.get(filePath);
  if (!snapshot) return false;
  try {
    const current = readFileSync(filePath, 'utf-8');
    return contentHash(current) !== snapshot.hash;
  } catch {
    return true;
  }
}

export function restoreSnapshot(filePath: string): boolean {
  const snapshot = snapshotStore.get(filePath);
  if (!snapshot) return false;
  try {
    writeFileSync(filePath, snapshot.content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ─── Checkpoint Operations ────────────────────────────────

export function createCheckpoint(label: string, files: string[], projectDir?: string): CheckpointMeta | null {
  ensureCheckpointDir();
  const id = `cp_${Date.now().toString(36)}`;
  const dir = join(CHECKPOINT_DIR, id);

  try {
    mkdirSync(dir, { recursive: true });
    let totalSize = 0;
    const fileMap: Record<string, string> = {};
    let idx = 0;

    for (const file of files) {
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf-8');
      const key = `f_${idx++}`;
      const relPath = relative(projectDir || process.cwd(), file);
      writeFileSync(join(dir, key), content, 'utf-8');
      fileMap[key] = relPath;
      totalSize += Buffer.byteLength(content, 'utf-8');
    }

    const meta: CheckpointMeta = {
      id,
      label,
      timestamp: Date.now(),
      files: idx,
      size: totalSize,
      projectDir: projectDir || process.cwd(),
      fileMap,
    };

    writeFileSync(join(dir, '_meta.json'), JSON.stringify(meta, null, 2));
    return meta;
  } catch {
    return null;
  }
}

export function listCheckpoints(): CheckpointMeta[] {
  ensureCheckpointDir();
  const dirs = readdirSync(CHECKPOINT_DIR);
  const checkpoints: CheckpointMeta[] = [];

  for (const dir of dirs) {
    const metaPath = join(CHECKPOINT_DIR, dir, '_meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      checkpoints.push(JSON.parse(readFileSync(metaPath, 'utf-8')));
    } catch {}
  }

  return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
}

export function restoreCheckpoint(id: string): boolean {
  const dir = join(CHECKPOINT_DIR, id);
  if (!existsSync(dir)) return false;

  const metaPath = join(dir, '_meta.json');
  if (!existsSync(metaPath)) return false;

  try {
    const meta: CheckpointMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const entries = readdirSync(dir).filter(f => f !== '_meta.json');

    for (const entry of entries) {
      const content = readFileSync(join(dir, entry), 'utf-8');
      const relPath = meta.fileMap?.[entry];
      const originalPath = relPath
        ? join(meta.projectDir, relPath)
        : join(meta.projectDir, entry.replace(/_/g, '/')); // fallback for old checkpoints
      mkdirSync(join(originalPath, '..'), { recursive: true });
      writeFileSync(originalPath, content, 'utf-8');
    }

    return true;
  } catch {
    return false;
  }
}

export function deleteCheckpoint(id: string): boolean {
  const dir = join(CHECKPOINT_DIR, id);
  if (!existsSync(dir)) return false;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      unlinkSync(join(dir, entry));
    }
    renameSync(dir, join(CHECKPOINT_DIR, `_deleted_${id}`));
    return true;
  } catch {
    return false;
  }
}

export function pruneCheckpoints(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
  const checkpoints = listCheckpoints();
  const now = Date.now();
  let pruned = 0;

  for (const cp of checkpoints) {
    if (now - cp.timestamp > maxAgeMs) {
      if (deleteCheckpoint(cp.id)) pruned++;
    }
  }

  return pruned;
}

// ─── Git-based Checkpoints ────────────────────────────────

export function createGitCheckpoint(label: string, projectDir?: string): CheckpointMeta | null {
  const dir = projectDir || process.cwd();
  try {
    execSync('git stash create kairo-checkpoint-auto', { cwd: dir, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
    // Fall back to regular checkpoint if git fails
    const files = readdirSync(dir, { recursive: true })
      .filter(f => {
        if (typeof f !== 'string') return false;
        const ext = f.toLowerCase();
        return ext.endsWith('.ts') || ext.endsWith('.js') || ext.endsWith('.py') || ext.endsWith('.json') || ext.endsWith('.md');
      })
      .map(f => join(dir, f as string))
      .filter(f => existsSync(f));

    return createCheckpoint(label, files, dir);
  } catch {
    return null;
  }
}
