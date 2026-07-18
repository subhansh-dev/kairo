/**
 * Git operations for session management.
 *
 * CLI for simple actions (stage, commit, push).
 * Structured data for status, diffs.
 */

import { execSync, exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(execCb);

export const GIT_STATUS_CACHE_TTL = 2000; // 2 seconds

export interface GitStatus {
  currentBranch: string;
  trackingBranch?: string;
  files: GitFileChange[];
  ahead: number;
  behind: number;
  isClean: boolean;
}

export interface GitFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'type_change';
  staged: boolean;
}

export interface GitCommitResult {
  hash: string;
  message: string;
}

export interface GitBranchEntry {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
}

/**
 * Run a git CLI command.
 */
export async function gitCli(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execAsync(
      `git --no-optional-locks ${args.join(' ')}`,
      { cwd, timeout: 30_000 }
    );
    return result.stdout.trim();
  } catch (err: any) {
    const stderr = err.stderr?.trim() || 'git command failed';
    throw new Error(stderr);
  }
}

/**
 * Get git status for a repository.
 */
export async function gitStatus(cwd: string): Promise<GitStatus> {
  const output = await gitCli(cwd, ['status', '--porcelain=v2', '--branch']);

  const lines = output.split('\n').filter(Boolean);
  let currentBranch = '';
  let trackingBranch: string | undefined;
  let ahead = 0;
  let behind = 0;
  const files: GitFileChange[] = [];

  for (const line of lines) {
    if (line.startsWith('# branch.oid ')) {
      // commit hash, skip
    } else if (line.startsWith('# branch.head ')) {
      currentBranch = line.slice('# branch.head '.length);
    } else if (line.startsWith('# branch.upstream ')) {
      trackingBranch = line.slice('# branch.upstream '.length);
    } else if (line.startsWith('# branch.ab ')) {
      const ab = line.slice('# branch.ab '.length).split(' ');
      ahead = parseInt(ab[0]) || 0;
      behind = parseInt(ab[1]) || 0;
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const parts = line.split(' ');
      const statusChar = parts[1];
      const staged = statusChar !== '?' && statusChar !== '!';
      const filePath = parts.slice(Math.max(parts.length - 1)).join(' ');

      files.push({
        path: filePath,
        status: mapGitStatus(statusChar),
        staged,
      });
    } else if (line.startsWith('? ')) {
      files.push({
        path: line.slice(2),
        status: 'untracked',
        staged: false,
      });
    }
  }

  return {
    currentBranch,
    trackingBranch,
    files,
    ahead,
    behind,
    isClean: files.length === 0,
  };
}

function mapGitStatus(char: string): GitFileChange['status'] {
  switch (char) {
    case 'A': return 'added';
    case 'M': return 'modified';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'T': return 'type_change';
    case '?': return 'untracked';
    default: return 'modified';
  }
}

/**
 * Stage files.
 */
export async function gitStage(cwd: string, files: string[]): Promise<void> {
  await gitCli(cwd, ['add', ...files]);
}

/**
 * Unstage files.
 */
export async function gitUnstage(cwd: string, files: string[]): Promise<void> {
  await gitCli(cwd, ['reset', 'HEAD', '--', ...files]);
}

/**
 * Commit changes.
 */
export async function gitCommit(
  cwd: string,
  message: string,
  files?: string[]
): Promise<GitCommitResult> {
  if (files && files.length > 0) {
    await gitCli(cwd, ['add', ...files]);
  }

  const output = await gitCli(cwd, ['commit', '-m', message]);
  const hashMatch = output.match(/\[([a-f0-9]+)\]/);
  const hash = hashMatch ? hashMatch[1] : '';

  return { hash, message };
}

/**
 * Discard changes to files.
 */
export async function gitDiscard(
  cwd: string,
  files: string[],
  scope: 'worktree' | 'staged' = 'worktree'
): Promise<void> {
  if (scope === 'staged') {
    await gitCli(cwd, ['checkout', 'HEAD', '--', ...files]);
  } else {
    await gitCli(cwd, ['checkout', '--', ...files]);
  }
}

/**
 * List branches.
 */
export async function gitBranchList(cwd: string): Promise<GitBranchEntry[]> {
  const output = await gitCli(cwd, ['branch', '-a', '--format=%(refname:short) %(refname:short) %(upstream:short)']);
  const lines = output.split('\n').filter(Boolean);

  return lines.map(line => {
    const parts = line.split(' ');
    const name = parts[0];
    const isCurrent = name.startsWith('* ');
    const branchName = isCurrent ? name.slice(2) : name;
    const isRemote = branchName.startsWith('remotes/');
    const upstream = parts[2] || undefined;

    return {
      name: branchName,
      isCurrent,
      isRemote,
      upstream,
    };
  });
}

/**
 * Get diff for files.
 */
export async function gitDiff(
  cwd: string,
  files?: string[],
  staged: boolean = false
): Promise<string> {
  const args = ['diff'];
  if (staged) args.push('--cached');
  if (files && files.length > 0) args.push('--', ...files);
  return gitCli(cwd, args);
}
