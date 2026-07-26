/**
 * Fast worktree — git worktree management for isolated workspaces.
 */

import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface WorktreeConfig {
  baseDir: string;
  mainBranch: string;
  prefix: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
}

const DEFAULT_CONFIG: WorktreeConfig = {
  baseDir: path.join(process.env.HOME || process.env.USERPROFILE || '', '.kairo', 'worktrees'),
  mainBranch: 'main',
  prefix: 'kairo',
};

/**
 * Create a new isolated worktree.
 */
export function createWorktree(
  repoPath: string,
  name: string,
  config: WorktreeConfig = DEFAULT_CONFIG,
): WorktreeInfo {
  const worktreePath = path.join(config.baseDir, name);

  if (!fs.existsSync(config.baseDir)) {
    fs.mkdirSync(config.baseDir, { recursive: true });
  }

  const branch = `${config.prefix}/${name}`;

  // Create worktree with new branch
  execSync(
    `git worktree add -b ${branch} "${worktreePath}" HEAD`,
    { cwd: repoPath, stdio: 'pipe' },
  );

  return {
    path: worktreePath,
    branch,
    head: getHead(worktreePath),
    isMain: false,
  };
}

/**
 * List all worktrees for a repo.
 */
export function listWorktrees(repoPath: string): WorktreeInfo[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const worktrees: WorktreeInfo[] = [];
    const blocks = output.split('\n\n');

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const pathMatch = lines.find(l => l.startsWith('worktree '));
      const headMatch = lines.find(l => l.startsWith('HEAD '));
      const branchMatch = lines.find(l => l.startsWith('branch '));

      if (pathMatch && headMatch) {
        const wtPath = pathMatch.slice('worktree '.length);
        worktrees.push({
          path: wtPath,
          branch: branchMatch?.slice('branch refs/heads/'.length) ?? 'detached',
          head: headMatch.slice('HEAD '.length),
          isMain: path.resolve(wtPath) === path.resolve(repoPath),
        });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Remove a worktree.
 */
export function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force: boolean = false,
): void {
  const flag = force ? '--force' : '';
  execSync(`git worktree remove ${flag} "${worktreePath}"`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
}

/**
 * Prune stale worktree references.
 */
export function pruneWorktrees(repoPath: string): void {
  execSync('git worktree prune', { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Get the current HEAD for a worktree.
 */
function getHead(worktreePath: string): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Check if a path is inside a git repository.
 */
export function isGitRepo(filePath: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: filePath,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the git repository root for a path.
 */
export function getGitRoot(filePath: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: filePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return null;
  }
}
