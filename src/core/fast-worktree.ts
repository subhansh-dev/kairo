/**
 * Kairo — Fast Worktree
 * Fast git worktree creation for parallel agents.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// ─── Types ──────────────────────────────────────────────────────

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isClean: boolean;
}

// ─── Operations ─────────────────────────────────────────────────

/**
 * Create a fast worktree for parallel agent work.
 */
export function createWorktree(
  repoDir: string,
  branchName: string,
  worktreeDir?: string,
): WorktreeInfo | null {
  const dir = worktreeDir || join(repoDir, '.kairo-worktrees', branchName);

  try {
    execSync(`git worktree add "${dir}" -b "${branchName}"`, {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    return {
      path: dir,
      branch: branchName,
      head: getHead(dir),
      isClean: true,
    };
  } catch {
    return null;
  }
}

/**
 * List all worktrees.
 */
export function listWorktrees(repoDir: string): WorktreeInfo[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current as WorktreeInfo);
        current = { path: line.slice(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === '') {
        if (current.path) {
          current.isClean = true; // would need git status to check
          worktrees.push(current as WorktreeInfo);
          current = {};
        }
      }
    }
    if (current.path) worktrees.push(current as WorktreeInfo);

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Remove a worktree.
 */
export function removeWorktree(repoDir: string, worktreePath: string): boolean {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prune stale worktrees.
 */
export function pruneWorktrees(repoDir: string): string[] {
  try {
    const output = execSync('git worktree prune', {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return output.split('\n').filter(l => l.trim());
  } catch {
    return [];
  }
}

/**
 * Check if a directory is a git repo.
 */
export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

/**
 * Get the git root directory.
 */
export function getGitRoot(dir: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return null;
  }
}

function getHead(dir: string): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return '';
  }
}
