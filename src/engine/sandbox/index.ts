/**
 * Sandbox — isolated execution environment.
 */

import * as child_process from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface SandboxConfig {
  timeoutMs: number;
  maxMemoryMb: number;
  maxOutputBytes: number;
  workingDir: string;
  env: Record<string, string>;
  allowedCommands?: string[];
  blockedCommands: string[];
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  timeoutMs: 30_000,
  maxMemoryMb: 512,
  maxOutputBytes: 1024 * 1024,
  workingDir: os.tmpdir(),
  env: {},
  blockedCommands: ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:'],
};

/**
 * Execute a command in a sandbox.
 */
export function sandboxExec(
  command: string,
  config?: Partial<SandboxConfig>,
): SandboxResult {
  const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };

  // Check blocked commands
  for (const blocked of cfg.blockedCommands) {
    if (command.includes(blocked)) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Blocked command: contains "${blocked}"`,
        timedOut: false,
        durationMs: 0,
      };
    }
  }

  const start = Date.now();

  try {
    const result = child_process.execSync(command, {
      cwd: cfg.workingDir,
      timeout: cfg.timeoutMs,
      maxBuffer: cfg.maxOutputBytes,
      encoding: 'utf-8',
      env: { ...process.env, ...cfg.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      exitCode: 0,
      stdout: result,
      stderr: '',
      timedOut: false,
      durationMs: Date.now() - start,
    };
  } catch (error: any) {
    const timedOut = error.killed === true || error.signal === 'SIGTERM';
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? '',
      timedOut,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Create a temporary sandbox directory.
 */
export function createSandboxDir(prefix: string = 'kairo-sandbox'): string {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Clean up a sandbox directory.
 */
export function cleanupSandboxDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}
