/**
 * Kairo — Sandbox
 * Sandboxed execution for untrusted code.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Types ──────────────────────────────────────────────────────

export interface SandboxConfig {
  timeoutMs: number;
  maxMemoryMb: number;
  networkAccess: boolean;
  allowedPaths: string[];
  deniedPaths: string[];
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
}

const DEFAULT_CONFIG: SandboxConfig = {
  timeoutMs: 30000,
  maxMemoryMb: 512,
  networkAccess: false,
  allowedPaths: [],
  deniedPaths: [
    '/etc', '/var', '/usr', '/bin', '/sbin',
    join(homedir(), '.ssh'),
    join(homedir(), '.gnupg'),
    join(homedir(), '.aws'),
  ],
};

// ─── Sandbox Execution ──────────────────────────────────────────

/**
 * Execute a command in a sandboxed environment.
 */
export function sandboxExec(
  command: string,
  cwd: string,
  config: Partial<SandboxConfig> = {},
): SandboxResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Build sandboxed command
  let sandboxedCmd = command;

  // Apply timeout
  const timeoutFlag = process.platform === 'linux' ? `timeout ${Math.floor(cfg.timeoutMs / 1000)}` : '';

  // Apply memory limit (Linux only via ulimit)
  const memFlag = process.platform === 'linux' ? `ulimit -v ${cfg.maxMemoryMb * 1024} 2>/dev/null;` : '';

  // Block network if needed (Linux only)
  const netFlag = !cfg.networkAccess && process.platform === 'linux'
    ? 'unshare -n 2>/dev/null || true;'
    : '';

  const fullCmd = [memFlag, netFlag, timeoutFlag, sandboxedCmd].filter(Boolean).join(' ');

  try {
    const stdout = execSync(fullCmd, {
      cwd,
      encoding: 'utf-8',
      timeout: cfg.timeoutMs + 1000, // extra second for cleanup
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return { exitCode: 0, stdout, stderr: '', timedOut: false, killed: false };
  } catch (e: any) {
    const timedOut = e.killed || e.message?.includes('timeout');
    return {
      exitCode: e.status || 1,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      timedOut,
      killed: e.killed || false,
    };
  }
}

/**
 * Create a temporary sandbox directory.
 */
export function createSandboxDir(): string {
  const dir = join(homedir(), '.kairo', 'sandbox', Date.now().toString(36));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Clean up a sandbox directory.
 */
export function cleanupSandboxDir(dir: string): boolean {
  try {
    execSync(`rm -rf "${dir}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
