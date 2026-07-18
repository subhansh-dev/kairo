/**
 * Jujutsu VCS support — jj status and operations.
 *
 */

import { execCommand, ShellCommand } from '../shell-base';

export interface JjStatus {
  workingCopy: string;
  bookmark?: string;
  files: JjFileChange[];
}

export interface JjFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

/**
 * Get jj status for a working copy.
 */
export async function jjStatus(cwd: string): Promise<JjStatus | null> {
  try {
    const result = await execCommand({ command: 'jj', args: ['status'], cwd });
    if (result.exitCode !== 0) return null;

    const lines = result.stdout.split('\n');
    const files: JjFileChange[] = [];
    let workingCopy = '';
    let bookmark: string | undefined;

    for (const line of lines) {
      if (line.startsWith('Working copy ')) {
        const match = line.match(/Working copy : (.+)/);
        if (match) workingCopy = match[1].trim();
      }
      if (line.startsWith('Bookmark: ')) {
        bookmark = line.substring(10).trim();
      }
      // Parse file changes
      const fileMatch = line.match(/^\s+([AMDR]):\s+(.+)/);
      if (fileMatch) {
        const statusMap: Record<string, JjFileChange['status']> = {
          A: 'added', M: 'modified', D: 'deleted', R: 'renamed',
        };
        files.push({
          path: fileMatch[2].trim(),
          status: statusMap[fileMatch[1]] || 'modified',
        });
      }
    }

    return { workingCopy, bookmark, files };
  } catch {
    return null;
  }
}

/**
 * Check if the current directory is a jj working copy.
 */
export async function isJjRepo(cwd: string): Promise<boolean> {
  try {
    const result = await execCommand({ command: 'jj', args: ['root'], cwd });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
