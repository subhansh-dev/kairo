import { spawnSync } from 'child_process';
import type { ToolDefinition, ToolResult } from './types.js';
import { getBashSession } from './bash.js';

const SAFE_COMMANDS = ['status', 'log', 'diff', 'show', 'branch', 'remote', 'tag', 'stash list', 'help', 'version', 'config'];
const WRITE_COMMANDS = ['add', 'commit', 'stash', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick', 'reset', 'push', 'pull', 'fetch', 'restore', 'rm', 'mv'];
const DESTRUCTIVE_COMMANDS = ['push --force', 'push -f', 'reset --hard', 'clean -f', 'clean -fd', 'branch -D', 'branch --delete --force'];

export const gitTool: ToolDefinition = {
  name: 'git',
  description: 'Git operations. Usage: git <args>',
  prompt: `Execute git commands. Safety classified.

Usage:
- git status — show working tree status
- git log — show commit history
- git diff — show changes
- git add <files> — stage files
- git commit -m "message" — commit staged changes
- git branch — list branches

Read commands auto-approved. Write commands may require approval. Destructive commands blocked.`,
  tier: 'exec',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  checkPermissions: (args: string) => {
    const cmd = args.trim().toLowerCase();
    for (const d of DESTRUCTIVE_COMMANDS) {
      if (cmd.includes(d)) return { allowed: false, reason: `Destructive: git ${d}` };
    }
    return { allowed: true };
  },

  execute: async (args: string, signal?: AbortSignal): Promise<ToolResult> => {
    try {
      const cmd = args.trim();
      if (!cmd) return { output: 'Usage: git <args>', success: false };

      const fullCmd = cmd.startsWith('git ') ? cmd : `git ${cmd}`;

      // Detect if this is a read-only command for classification
      const cmdLower = cmd.toLowerCase();
      const isReadCommand = SAFE_COMMANDS.some(sc => cmdLower.startsWith(sc));

      const startTime = Date.now();
      const bashSession = getBashSession();
      const result = spawnSync(fullCmd, {
        shell: true,
        encoding: 'utf-8',
        timeout: isReadCommand ? 15_000 : 30_000,
        cwd: bashSession.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const duration = Date.now() - startTime;

      // Check abort signal after execution
      if (signal?.aborted) {
        return { output: 'Cancelled.', success: false, metadata: { exitCode: -1, command: fullCmd } };
      }

      const stdout = (result.stdout || '').trim();
      const stderr = (result.stderr || '').trim();
      const exitCode = result.status ?? 0;
      const output = stdout + (stderr ? '\n[stderr]\n' + stderr : '');

      return {
        output: exitCode === 0 ? (output || '(no output)') : `Exit ${exitCode} (${duration}ms):\n${output}`,
        success: exitCode === 0,
        metadata: { exitCode, command: fullCmd, duration },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
