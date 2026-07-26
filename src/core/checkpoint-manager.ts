/**
 * Kairo — Checkpoint Manager
 * Transparent filesystem snapshots via git before file-mutating operations.
 * Ported from Hermes Agent's checkpoint_manager.py
 *
 * Creates automatic snapshots of working directories before write/edit/exec
 * operations. Provides rollback to any previous checkpoint.
 *
 * Storage: ~/.kairo/checkpoints/ with a single shared git store.
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative, normalize } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

// ─── Constants ──────────────────────────────────────────────────

const CHECKPOINT_BASE = join(homedir(), '.kairo', 'checkpoints');
const STORE_DIRNAME = 'store';
const REFS_PREFIX = 'refs/kairo';
const INDEXES_DIRNAME = 'indexes';
const PROJECTS_DIRNAME = 'projects';

const DEFAULT_EXCLUDES = [
  'node_modules/', 'dist/', 'build/', 'target/', 'out/', '.next/', '.nuxt/',
  '__pycache__/', '*.pyc', '*.pyo', '.cache/', '.pytest_cache/', '.mypy_cache/',
  '.ruff_cache/', 'coverage/', '.coverage', '.venv/', 'venv/', 'env/',
  '.git/', '.hg/', '.svn/', '.worktrees/',
  '*.so', '*.dylib', '*.dll', '*.o', '*.a', '*.jar', '*.class', '*.exe', '*.obj',
  '*.mp4', '*.mov', '*.mkv', '*.webm', '*.zip', '*.tar', '*.tar.gz', '*.tgz',
  '*.7z', '*.rar', '*.iso',
  '.env', '.env.*', '.env.local', '.env.*.local',
  '.DS_Store', 'Thumbs.db', '*.log',
];

const GIT_TIMEOUT = 30_000;
const MAX_FILES = 50_000;

// ─── Types ──────────────────────────────────────────────────────

export interface CheckpointInfo {
  hash: string;
  workdir: string;
  createdAt: number;
  message?: string;
}

export interface CheckpointDiff {
  filesAdded: string[];
  filesModified: string[];
  filesDeleted: string[];
}

// ─── Helpers ────────────────────────────────────────────────────

function projectHash(workdir: string): string {
  return createHash('sha256').update(normalize(workdir)).digest('hex').slice(0, 16);
}

function storeDir(): string {
  return join(CHECKPOINT_BASE, STORE_DIRNAME);
}

function ensureStore(): void {
  const store = storeDir();
  if (!existsSync(store)) {
    mkdirSync(store, { recursive: true });
    try {
      execSync('git init --bare', { cwd: store, timeout: GIT_TIMEOUT, stdio: 'pipe' });
    } catch {}
  }
  const indexes = join(store, INDEXES_DIRNAME);
  const projects = join(store, PROJECTS_DIRNAME);
  if (!existsSync(indexes)) mkdirSync(indexes, { recursive: true });
  if (!existsSync(projects)) mkdirSync(projects, { recursive: true });
}

function git(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd: cwd || storeDir(),
      timeout: GIT_TIMEOUT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch {
    return '';
  }
}

function buildExcludeFile(): string {
  const excludesPath = join(storeDir(), 'info', 'exclude');
  const dir = join(storeDir(), 'info');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(excludesPath, DEFAULT_EXCLUDES.join('\n') + '\n');
  return excludesPath;
}

// ─── Core Functions ─────────────────────────────────────────────

/**
 * Create a checkpoint snapshot of the given working directory.
 * Returns the commit hash, or null if nothing changed.
 */
export function createCheckpoint(workdir: string, message?: string): string | null {
  ensureStore();
  const hash = projectHash(workdir);
  const store = storeDir();
  const indexFile = join(store, INDEXES_DIRNAME, hash);
  const refName = `${REFS_PREFIX}/${hash}`;
  const excludeFile = buildExcludeFile();

  // Update project metadata
  const projectMeta = join(store, PROJECTS_DIRNAME, `${hash}.json`);
  writeFileSync(projectMeta, JSON.stringify({
    workdir: resolve(workdir),
    created_at: existsSync(projectMeta)
      ? JSON.parse(readFileSync(projectMeta, 'utf-8')).created_at
      : Date.now(),
    last_touch: Date.now(),
  }, null, 2));

  // Stage all files using the project-specific index
  const env = {
    ...process.env,
    GIT_DIR: store,
    GIT_WORK_TREE: resolve(workdir),
    GIT_INDEX_FILE: indexFile,
    GIT_TERMINAL_PROMPT: '0',
  };

  try {
    execSync(`git add -A --exclude-from="${excludeFile}"`, {
      cwd: resolve(workdir),
      env,
      timeout: GIT_TIMEOUT,
      stdio: 'pipe',
    });
  } catch {
    return null;
  }

  // Check if there are staged changes
  try {
    const diff = execSync('git diff --cached --quiet', { env, timeout: GIT_TIMEOUT, stdio: 'pipe' });
    // If no diff, nothing to commit
    return null;
  } catch {
    // diff exits 1 if there ARE changes — this is expected
  }

  // Commit
  const commitMsg = message || `kairo checkpoint ${new Date().toISOString()}`;
  try {
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
      env,
      timeout: GIT_TIMEOUT,
      stdio: 'pipe',
    });
    // Get the commit hash
    const commitHash = execSync('git rev-parse HEAD', { env, timeout: GIT_TIMEOUT, encoding: 'utf-8' }).trim();
    // Update the ref
    execSync(`git update-ref ${refName} ${commitHash}`, { env: { ...env, GIT_DIR: store }, timeout: GIT_TIMEOUT, stdio: 'pipe' });
    return commitHash;
  } catch {
    return null;
  }
}

/**
 * List all checkpoints for a working directory.
 */
export function listCheckpoints(workdir: string): CheckpointInfo[] {
  ensureStore();
  const hash = projectHash(workdir);
  const store = storeDir();
  const refName = `${REFS_PREFIX}/${hash}`;

  try {
    const log = execSync(
      `git log --format="%H %ct %s" ${refName}`,
      { cwd: store, timeout: GIT_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!log) return [];

    return log.split('\n').map(line => {
      const parts = line.split(' ');
      const commitHash = parts[0];
      const timestamp = parseInt(parts[1]) * 1000;
      const msg = parts.slice(2).join(' ');
      return { hash: commitHash, workdir: resolve(workdir), createdAt: timestamp, message: msg };
    });
  } catch {
    return [];
  }
}

/**
 * Rollback to a specific checkpoint.
 */
export function rollbackCheckpoint(workdir: string, commitHash: string): boolean {
  ensureStore();
  const hash = projectHash(workdir);
  const store = storeDir();
  const indexFile = join(store, INDEXES_DIRNAME, hash);

  const env = {
    ...process.env,
    GIT_DIR: store,
    GIT_WORK_TREE: resolve(workdir),
    GIT_INDEX_FILE: indexFile,
    GIT_TERMINAL_PROMPT: '0',
  };

  try {
    // Read the tree from the commit and checkout
    execSync(`git read-tree ${commitHash}`, { env, timeout: GIT_TIMEOUT, stdio: 'pipe' });
    execSync('git checkout-index -a -f', { env, timeout: GIT_TIMEOUT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get diff between two checkpoints (or current vs latest).
 */
export function diffCheckpoint(workdir: string, fromHash?: string, toHash?: string): CheckpointDiff {
  ensureStore();
  const hash = projectHash(workdir);
  const store = storeDir();
  const refName = `${REFS_PREFIX}/${hash}`;

  const from = fromHash || `${refName}~1`;
  const to = toHash || refName;

  try {
    const diff = execSync(
      `git diff --name-status ${from} ${to}`,
      { cwd: store, timeout: GIT_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!diff) return { filesAdded: [], filesModified: [], filesDeleted: [] };

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const line of diff.split('\n')) {
      const [status, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');
      if (status === 'A') added.push(filePath);
      else if (status === 'M') modified.push(filePath);
      else if (status === 'D') deleted.push(filePath);
    }

    return { filesAdded: added, filesModified: modified, filesDeleted: deleted };
  } catch {
    return { filesAdded: [], filesModified: [], filesDeleted: [] };
  }
}

/**
 * Prune old checkpoints.
 */
export function pruneCheckpoints(retentionDays: number = 30, maxSizeMb: number = 500): void {
  ensureStore();
  const store = storeDir();
  const projectsDir = join(store, PROJECTS_DIRNAME);

  if (!existsSync(projectsDir)) return;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const file of readdirSync(projectsDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(readFileSync(join(projectsDir, file), 'utf-8'));
      if (meta.last_touch < cutoff) {
        const hash = file.replace('.json', '');
        // Delete ref
        const refName = `${REFS_PREFIX}/${hash}`;
        execSync(`git update-ref -d ${refName}`, { cwd: store, timeout: GIT_TIMEOUT, stdio: 'pipe' });
        // Delete index
        const indexFile = join(store, INDEXES_DIRNAME, hash);
        if (existsSync(indexFile)) {
          try { execSync(`rm -f "${indexFile}"`, { timeout: 5000, stdio: 'pipe' }); } catch {}
        }
        // Delete project meta
        execSync(`rm -f "${join(projectsDir, file)}"`, { timeout: 5000, stdio: 'pipe' });
      }
    } catch {}
  }

  // Run git gc
  try {
    execSync('git gc --prune=now', { cwd: store, timeout: 60_000, stdio: 'pipe' });
  } catch {}
}

/**
 * Check if checkpoint system is available (git installed).
 */
export function isCheckpointAvailable(): boolean {
  try {
    execSync('git --version', { timeout: 5000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
