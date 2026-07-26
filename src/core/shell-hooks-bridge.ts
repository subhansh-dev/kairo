/**
 * Shell-script hooks bridge.
 *
 * Reads hook configurations, prompts for consent on first use, and registers
 * callbacks so shell scripts dispatch through the existing hook system.
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ShellHookConfig {
  event: string;      // 'pre_tool_call' | 'post_tool_call' | 'on_session_start' | 'on_session_end'
  command: string;    // Shell command to run
  description?: string;
}

export interface ShellHookResult {
  decision?: string;  // 'block' | 'allow'
  action?: string;    // 'block' | 'allow'
  reason?: string;
  message?: string;
  context?: string;
}

const ALLOWLIST_FILE = join(homedir(), '.kairo', 'shell-hooks-allowlist.json');

/**
 * Load the shell hooks allowlist.
 */
function loadAllowlist(): Set<string> {
  try {
    if (existsSync(ALLOWLIST_FILE)) {
      const data = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf-8'));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch { /* ok */ }
  return new Set();
}

/**
 * Save the shell hooks allowlist.
 */
function saveAllowlist(allowlist: Set<string>): void {
  try {
    const dir = join(homedir(), '.kairo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ALLOWLIST_FILE, JSON.stringify([...allowlist]), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Check if a hook is allowed (consent given).
 */
export function isHookAllowed(event: string, command: string): boolean {
  const key = `${event}:${command}`;
  return loadAllowlist().has(key);
}

/**
 * Grant consent for a hook.
 */
export function allowHook(event: string, command: string): void {
  const key = `${event}:${command}`;
  const allowlist = loadAllowlist();
  allowlist.add(key);
  saveAllowlist(allowlist);
}

/**
 * Execute a shell hook and return the parsed result.
 */
export async function executeShellHook(
  event: string,
  command: string,
  payload: Record<string, unknown>,
): Promise<ShellHookResult> {
  return new Promise((resolve) => {
    try {
      const input = JSON.stringify({
        hook_event_name: event,
        ...payload,
      });

      const proc = spawn('sh', ['-c', command], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10_000, // 10s timeout
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ decision: 'allow' }); // fail-open
          return;
        }
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve({ decision: 'allow' }); // non-JSON = no-op
        }
      });

      proc.on('error', () => {
        resolve({ decision: 'allow' }); // fail-open
      });

      proc.stdin.write(input);
      proc.stdin.end();
    } catch {
      resolve({ decision: 'allow' }); // fail-open
    }
  });
}

/**
 * Normalize a hook result to a standard format.
 */
export function normalizeHookResult(result: ShellHookResult): {
  blocked: boolean;
  reason: string;
  context?: string;
} {
  const action = result.decision || result.action || 'allow';
  const reason = result.reason || result.message || '';
  return {
    blocked: action === 'block',
    reason,
    context: result.context,
  };
}
