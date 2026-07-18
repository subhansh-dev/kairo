/**
 * Compact git status for system prompts.
 *
 * Uses git CLI for performance. Output prioritized by change type
 * and limited to ~1k characters.
 */

import { execSync } from 'child_process';

const GIT_STATUS_BUFFER_LIMIT = 1024 * 1024;

/**
 * Collapse runs of 2+ spaces to a single space.
 */
function collapseStatusSpaces(s: string): string {
  return s.replace(/ {2,}/g, ' ');
}

/**
 * Get compact git status for the system prompt.
 * Output includes branch, ahead/behind, staged files.
 * Total output capped at ~1k characters.
 */
export async function gitStatusCompact(cwd: string): Promise<string> {
  try {
    const output = execSync(
      'git --no-optional-locks status --short --branch',
      { cwd, timeout: 10_000, maxBuffer: GIT_STATUS_BUFFER_LIMIT, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString();

    if (output.length >= GIT_STATUS_BUFFER_LIMIT) {
      return ''; // Repo too large, drop from prompt
    }

    return collapseStatusSpaces(output.trim());
  } catch {
    return '';
  }
}

/**
 * Get git status with file change details.
 */
export async function gitStatusDetailed(cwd: string): Promise<{
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
}> {
  const result = { branch: '', ahead: 0, behind: 0, staged: [] as string[], modified: [] as string[], untracked: [] as string[] };

  try {
    const output = execSync(
      'git --no-optional-locks status --porcelain=v2 --branch',
      { cwd, timeout: 10_000, maxBuffer: GIT_STATUS_BUFFER_LIMIT, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString();

    const lines = output.split('\n').filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('# branch.head ')) {
        result.branch = line.slice('# branch.head '.length);
      } else if (line.startsWith('# branch.ab ')) {
        const ab = line.slice('# branch.ab '.length).split(' ');
        result.ahead = parseInt(ab[0]) || 0;
        result.behind = parseInt(ab[1]) || 0;
      } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
        const parts = line.split(' ');
        const status = parts[1];
        const filePath = parts[parts.length - 1];
        if (parts[1]?.[0] !== '?' && parts[1]?.[0] !== '!') {
          result.staged.push(filePath);
        } else {
          result.modified.push(filePath);
        }
      } else if (line.startsWith('? ')) {
        result.untracked.push(line.slice(2));
      }
    }
  } catch { /* */ }

  return result;
}
